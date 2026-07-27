import type { Position } from "@/domain/league/types";
import type { PlayerProjection, ProjectionStats } from "@/domain/players/types";

import { normalizePosition } from "./match-player";
import type { ProjectionSnapshot, ProjectionSnapshotData } from "./types";

export const SLEEPER_PROJECTION_SOURCE = "Sleeper season projections";
export const MAX_PROJECTION_RESPONSE_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const statMap = {
  pass_yd: "passYards", pass_td: "passTds", pass_int: "interceptions",
  rush_yd: "rushYards", rush_td: "rushTds", rec: "receptions",
  rec_yd: "receivingYards", rec_td: "receivingTds", fum_lost: "fumblesLost",
} as const satisfies Record<string, keyof ProjectionStats>;
const maxRows = 20_000;
const supportedStatNames = new Set<string>(Object.values(statMap));

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

type NormalizedRow = Omit<PlayerProjection, "source" | "updatedAt"> & { sourceUpdatedAt: number };

function sourceTimestamp(raw: Record<string, unknown>): number | null {
  const upperBound = Date.now() + 2 * 365 * 24 * 60 * 60 * 1000;
  for (const candidate of [raw.updated_at, raw.last_modified]) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= Date.UTC(2000, 0, 1) && value <= upperBound) return value;
  }
  return null;
}

function hasOnlySupportedStats(stats: Record<string, unknown>): boolean {
  const entries = Object.entries(stats);
  return entries.length > 0 && entries.every(([name, value]) => supportedStatNames.has(name) && typeof value === "number" && Number.isFinite(value));
}

function normalizeOne(raw: unknown, fallbackId: string | undefined, expectedSeason: number): NormalizedRow | null {
  if (!isRecord(raw)) return null;
  if (raw.season !== undefined && String(raw.season) !== String(expectedSeason)) return null;
  if (raw.season_type !== undefined && raw.season_type !== "regular") return null;
  const sourceUpdatedAt = sourceTimestamp(raw);
  if (sourceUpdatedAt === null) return null;
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
  if (Object.keys(stats).length === 0) return null;
  return { playerId, name, team: safeText(player.team) ?? safeText(raw.team), positions, stats, sourceUpdatedAt };
}

export function normalizeSleeperProjections(payload: unknown, expectedSeason: number): {
  projections: PlayerProjection[];
  updatedAt: string | null;
} {
  const rows = Array.isArray(payload)
    ? payload.map((value) => [undefined, value] as const)
    : isRecord(payload)
      ? Object.entries(payload)
      : [];
  if (rows.length === 0 || rows.length > maxRows) return { projections: [], updatedAt: null };
  const byId = new Map<string, NormalizedRow>();
  for (const [id, row] of rows) {
    const normalized = normalizeOne(row, id, expectedSeason);
    if (normalized && !byId.has(normalized.playerId)) byId.set(normalized.playerId, normalized);
  }
  const accepted = [...byId.values()];
  if (accepted.length === 0) return { projections: [], updatedAt: null };
  const updatedAt = new Date(Math.max(...accepted.map((row) => row.sourceUpdatedAt))).toISOString();
  const projections = accepted.map((row) => ({
    playerId: row.playerId,
    name: row.name,
    team: row.team,
    positions: row.positions,
    stats: row.stats,
    source: SLEEPER_PROJECTION_SOURCE,
    updatedAt,
  })).sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true }));
  return { projections, updatedAt };
}

export function validateProjectionSnapshot(snapshot: ProjectionSnapshotData, minimumOffensivePlayers = 100): ProjectionSnapshotData {
  if (!snapshot || !Array.isArray(snapshot.projections) || !safeText(snapshot.source) || !Number.isFinite(Date.parse(snapshot.updatedAt))) throw new Error("Invalid projection snapshot");
  const ids = new Set<string>();
  let offensive = 0;
  for (const projection of snapshot.projections) {
    if (!projection || !safeText(projection.playerId) || !safeText(projection.name) || !Array.isArray(projection.positions) || projection.positions.length === 0 || !isRecord(projection.stats) || !hasOnlySupportedStats(projection.stats) || ids.has(projection.playerId)) throw new Error("Invalid projection record");
    ids.add(projection.playerId);
    if (projection.positions.some((position) => ["QB", "RB", "WR", "TE"].includes(position))) offensive += 1;
  }
  if (offensive < minimumOffensivePlayers) throw new Error(`Projection snapshot has only ${offensive} offensive players`);
  return snapshot;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Sleeper projection request failed with HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PROJECTION_RESPONSE_BYTES) throw new Error("Sleeper projection response is too large");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROJECTION_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Sleeper projection response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createSleeperProjectionProvider(options: {
  season: number;
  fallback: ProjectionSnapshotData;
  fetcher?: (url: string) => Promise<unknown>;
  request?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}) {
  const fetcher = options.fetcher ?? (async (url: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await (options.request ?? fetch)(url, { signal: controller.signal });
      return await readBoundedJson(response);
    } finally {
      clearTimeout(timeout);
    }
  });
  return {
    async load(): Promise<ProjectionSnapshot> {
      try {
        const payload = await fetcher(`https://api.sleeper.com/projections/nfl/${options.season}?season_type=regular`);
        const { projections, updatedAt } = normalizeSleeperProjections(payload, options.season);
        if (!updatedAt) throw new Error("Sleeper projection response has no validated update metadata");
        return { ...validateProjectionSnapshot({ source: SLEEPER_PROJECTION_SOURCE, updatedAt, projections }), stale: false };
      } catch {
        validateProjectionSnapshot(options.fallback, 1);
        return { ...options.fallback, stale: true };
      }
    },
  };
}
