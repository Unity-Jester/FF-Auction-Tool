import type { Position } from "@/domain/league/types";
import type { PlayerProjection, ProjectionStats } from "@/domain/players/types";

import { normalizePosition } from "./match-player";
import type { ProjectionSnapshot, ProjectionSnapshotData } from "./types";

export const SLEEPER_PROJECTION_SOURCE = "Sleeper season projections";
const statMap = {
  pass_yd: "passYards", pass_td: "passTds", pass_int: "interceptions",
  rush_yd: "rushYards", rush_td: "rushTds", rec: "receptions",
  rec_yd: "receivingYards", rec_td: "receivingTds", fum_lost: "fumblesLost",
} as const satisfies Record<string, keyof ProjectionStats>;
const maxRows = 20_000;

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160 ? value.trim() : null;
}
function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100_000 ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function positionsFrom(raw: Record<string, unknown>): Position[] {
  const player = isRecord(raw.player) ? raw.player : raw;
  const candidates = [player.position, ...(Array.isArray(player.fantasy_positions) ? player.fantasy_positions : [])];
  return candidates
    .map((candidate) => normalizePosition(typeof candidate === "string" ? candidate : undefined))
    .filter((position): position is Position => !!position)
    .filter((position, index, all) => all.indexOf(position) === index);
}

function normalizeOne(raw: unknown, fallbackId: string | undefined, updatedAt: string): PlayerProjection | null {
  if (!isRecord(raw)) return null;
  const player = isRecord(raw.player) ? raw.player : raw;
  const playerId = safeText(raw.player_id ?? player.player_id ?? fallbackId);
  const constructedName = [safeText(player.first_name), safeText(player.last_name)].filter(Boolean).join(" ");
  const name = (safeText(player.full_name) ?? constructedName) || safeText(player.team) || safeText(raw.team);
  const positions = positionsFrom(raw);
  if (!playerId || !name || positions.length === 0) return null;
  const statsRaw = isRecord(raw.stats) ? raw.stats : raw;
  const stats: ProjectionStats = {};
  for (const [source, target] of Object.entries(statMap)) {
    const value = safeNumber(statsRaw[source]);
    if (value !== undefined) stats[target] = value;
  }
  return { playerId, name, team: safeText(player.team) ?? safeText(raw.team), positions, stats, source: SLEEPER_PROJECTION_SOURCE, updatedAt };
}

export function normalizeSleeperProjections(payload: unknown, updatedAt: string): PlayerProjection[] {
  const rows = Array.isArray(payload)
    ? payload.map((value) => [undefined, value] as const)
    : isRecord(payload)
      ? Object.entries(payload)
      : [];
  if (rows.length === 0 || rows.length > maxRows) return [];
  const byId = new Map<string, PlayerProjection>();
  for (const [id, row] of rows) {
    const normalized = normalizeOne(row, id, updatedAt);
    if (normalized && !byId.has(normalized.playerId)) byId.set(normalized.playerId, normalized);
  }
  return [...byId.values()].sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true }));
}

export function validateProjectionSnapshot(snapshot: ProjectionSnapshotData, minimumOffensivePlayers = 100): ProjectionSnapshotData {
  if (!snapshot || !Array.isArray(snapshot.projections) || !safeText(snapshot.source) || !Number.isFinite(Date.parse(snapshot.updatedAt))) throw new Error("Invalid projection snapshot");
  const ids = new Set<string>();
  let offensive = 0;
  for (const projection of snapshot.projections) {
    if (!projection || !safeText(projection.playerId) || !safeText(projection.name) || !Array.isArray(projection.positions) || projection.positions.length === 0 || !isRecord(projection.stats) || ids.has(projection.playerId)) throw new Error("Invalid projection record");
    ids.add(projection.playerId);
    if (projection.positions.some((position) => ["QB", "RB", "WR", "TE"].includes(position))) offensive += 1;
  }
  if (offensive < minimumOffensivePlayers) throw new Error(`Projection snapshot has only ${offensive} offensive players`);
  return snapshot;
}

export function createSleeperProjectionProvider(options: {
  season: number;
  fallback: ProjectionSnapshotData;
  fetcher?: (url: string) => Promise<unknown>;
}) {
  const fetcher = options.fetcher ?? (async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sleeper projection request failed with HTTP ${response.status}`);
    return response.json();
  });
  return {
    async load(): Promise<ProjectionSnapshot> {
      try {
        const updatedAt = new Date().toISOString();
        const payload = await fetcher(`https://api.sleeper.com/projections/nfl/${options.season}?season_type=regular`);
        const projections = normalizeSleeperProjections(payload, updatedAt);
        return { ...validateProjectionSnapshot({ source: SLEEPER_PROJECTION_SOURCE, updatedAt, projections }), stale: false };
      } catch {
        validateProjectionSnapshot(options.fallback, 1);
        return { ...options.fallback, stale: true };
      }
    },
  };
}
