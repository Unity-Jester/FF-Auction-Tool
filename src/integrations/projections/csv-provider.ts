import Papa from "papaparse";

import type { PlayerProjection, ProjectionStats } from "@/domain/players/types";

import { matchProjectionPlayer, normalizePosition } from "./match-player";
import {
  CSV_MATCH_LIMIT_ERROR,
  MAX_CSV_FILE_BYTES,
  MAX_CSV_MATCHED_OVERRIDES,
  MAX_CSV_ROWS,
} from "./csv-limits";
import type { CsvProjectionResult, CsvProjectionRow, ProjectionPlayer } from "./types";

const supportedStats = {
  pass_yd: "passYards", pass_td: "passTds", pass_int: "interceptions",
  rush_yd: "rushYards", rush_td: "rushTds", rec: "receptions",
  rec_yd: "receivingYards", rec_td: "receivingTds", fum_lost: "fumblesLost",
} as const satisfies Record<string, keyof ProjectionStats>;
const allowedColumns = new Set(["player_id", "name", "team", "position", ...Object.keys(supportedStats)]);

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 160 ? value.trim() : undefined;
}
function rowInfo(row: Record<string, unknown>, reason?: string): CsvProjectionRow {
  return { sourceName: clean(row.name) ?? "", playerId: clean(row.player_id), team: clean(row.team)?.toUpperCase(), position: normalizePosition(clean(row.position)), reason };
}
function safeStat(value: unknown): number | undefined {
  const text = clean(value);
  if (!text || /^[=+\-@]/.test(text) || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) && Math.abs(number) <= 100_000 ? number : undefined;
}

export function parseProjectionCsv(csv: string, players: readonly ProjectionPlayer[]): CsvProjectionResult {
  const result: CsvProjectionResult = { matched: [], unmatched: [], ambiguous: [], duplicates: [], unsupported: [] };
  if (typeof csv !== "string" || new TextEncoder().encode(csv).byteLength > MAX_CSV_FILE_BYTES) {
    result.unsupported.push({ sourceName: "", reason: "CSV exceeds the 1 MB limit" });
    return result;
  }
  const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: "greedy", transformHeader: (header) => header.trim().toLowerCase() });
  if (parsed.errors.length || parsed.data.length > MAX_CSV_ROWS) {
    result.unsupported.push({ sourceName: "", reason: parsed.data.length > MAX_CSV_ROWS ? "CSV exceeds the 5,000 row limit" : "CSV could not be parsed" });
    return result;
  }
  const headers = Object.keys(parsed.meta.fields ? Object.fromEntries(parsed.meta.fields.map((field) => [field, true])) : {});
  const invalidHeaders = headers.filter((header) => !allowedColumns.has(header) || header === "__proto__" || header === "constructor" || header === "prototype");
  const pending = new Map<string, { projection: PlayerProjection; info: CsvProjectionRow }[]>();
  for (const row of parsed.data) {
    const info = rowInfo(row);
    if (invalidHeaders.length) { result.unsupported.push({ ...info, reason: `Unsupported columns: ${invalidHeaders.join(", ")}` }); continue; }
    const match = matchProjectionPlayer({ playerId: clean(row.player_id), name: clean(row.name), team: clean(row.team), position: clean(row.position) }, players);
    if (match.kind === "ambiguous") { result.ambiguous.push({ ...info, candidates: match.candidates, reason: "Multiple player records match this name" }); continue; }
    if (match.kind === "unmatched") { result.unmatched.push({ ...info, reason: "No unique Sleeper player match" }); continue; }
    const stats: ProjectionStats = {};
    let invalidStat = false;
    for (const [column, target] of Object.entries(supportedStats)) {
      if (row[column] === undefined || clean(row[column]) === undefined) continue;
      const value = safeStat(row[column]);
      if (value === undefined) { invalidStat = true; break; }
      stats[target] = value;
    }
    if (invalidStat || Object.keys(stats).length === 0) { result.unsupported.push({ ...info, reason: invalidStat ? "Statistics must be finite plain numbers" : "No supported statistics supplied" }); continue; }
    const player = match.player;
    const projection = { playerId: player.playerId, name: player.name, team: player.team, positions: [...player.positions], stats, source: "CSV override", updatedAt: new Date().toISOString() } satisfies PlayerProjection;
    const matches = pending.get(player.playerId) ?? [];
    matches.push({ projection, info: { ...info, playerId: player.playerId, stats } });
    pending.set(player.playerId, matches);
  }
  for (const matches of pending.values()) {
    if (matches.length === 1) result.matched.push(matches[0].projection);
    else result.duplicates.push(...matches.map(({ info }) => ({ ...info, reason: "Multiple CSV rows resolve to this player" })));
  }
  if (result.matched.length > MAX_CSV_MATCHED_OVERRIDES) {
    result.unsupported.push({ sourceName: "", reason: CSV_MATCH_LIMIT_ERROR });
  }
  return result;
}
