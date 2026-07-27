import type { Position } from "@/domain/league/types";

import type { ProjectionPlayer } from "./types";

const aliases: Record<string, string> = {
  "d st": "defense",
  dst: "defense",
  defense: "defense",
};

export function normalizeProjectionName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return aliases[normalized] ?? normalized;
}

export function normalizePosition(value: string | undefined): Position | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "D/ST" || normalized === "DST" || normalized === "DEFENSE") return "DEF";
  return normalized === "QB" || normalized === "RB" || normalized === "WR" || normalized === "TE" || normalized === "K" || normalized === "DEF"
    ? normalized
    : undefined;
}

export type PlayerMatch =
  | { kind: "matched"; player: ProjectionPlayer }
  | { kind: "unmatched" }
  | { kind: "ambiguous"; candidates: string[] };

function normalizeTeam(value: string | null | undefined): string | null | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return value === null ? null : undefined;
  if (normalized === "FA" || normalized === "NONE" || normalized === "FREE AGENT") return null;
  return normalized === "JAC" ? "JAX" : normalized;
}

export function matchProjectionPlayer(
  input: { playerId?: string; name?: string; team?: string; position?: string },
  players: readonly ProjectionPlayer[],
): PlayerMatch {
  if (input.playerId?.trim()) {
    const player = players.find((candidate) => candidate.playerId === input.playerId!.trim());
    return player ? { kind: "matched", player } : { kind: "unmatched" };
  }
  if (!input.name?.trim() || !input.position?.trim()) return { kind: "unmatched" };
  const position = normalizePosition(input.position);
  if (!position) return { kind: "unmatched" };
  const name = normalizeProjectionName(input.name);
  const team = normalizeTeam(input.team);
  const candidates = players.filter(
    (player) =>
      normalizeProjectionName(player.name) === name &&
      (team === undefined || normalizeTeam(player.team) === team) &&
      player.positions.includes(position),
  );
  if (team !== undefined && candidates.length === 1) return { kind: "matched", player: candidates[0] };
  if (candidates.length > 1) return { kind: "ambiguous", candidates: candidates.map((player) => player.playerId).sort() };
  const nameAndPosition = players.filter(
    (player) => normalizeProjectionName(player.name) === name && player.positions.includes(position),
  );
  return nameAndPosition.length > 1
    ? { kind: "ambiguous", candidates: nameAndPosition.map((player) => player.playerId).sort() }
    : { kind: "unmatched" };
}
