import {
  createLeagueConfig,
  type CreateLeagueConfigInput,
} from "@/domain/league/defaults";
import type { LeagueConfig } from "@/domain/league/types";

const key = (draftId: string) => `sleeper-auction-companion:league:${draftId}`;

function fingerprint(league: LeagueConfig): string {
  return JSON.stringify({
    teams: league.teams,
    budget: league.budget,
    minBid: league.minBid,
    starters: league.starters,
    bench: league.bench,
    flex: league.flex,
    scoring: league.scoring,
    capKickerDefenseAtOne: league.capKickerDefenseAtOne,
  });
}

export function saveLeagueConfig(
  draftId: string,
  league: LeagueConfig,
  importedLeague: LeagueConfig = league,
) {
  try {
    localStorage.setItem(key(draftId), JSON.stringify({
      version: 2,
      league,
      importedFingerprint: fingerprint(importedLeague),
    }));
  } catch {}
}
export function loadLeagueConfig(draftId: string): LeagueConfig | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(draftId)) ?? "null");
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2)) return null;
    const l = parsed.league;
    return createLeagueConfig({
      teams: l.teams,
      budget: l.budget,
      minBid: l.minBid,
      starters: l.starters,
      bench: l.bench,
      flex: l.flex,
      receptionPoints: l.scoring.reception,
      scoring: l.scoring,
      capKickerDefenseAtOne: l.capKickerDefenseAtOne,
    } as CreateLeagueConfigInput);
  } catch {
    return null;
  }
}

export type LeagueSetupStatus = "none" | "match" | "mismatch" | "legacy";

export function leagueSetupStatus(
  draftId: string,
  importedLeague: LeagueConfig,
): LeagueSetupStatus {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(draftId)) ?? "null");
    if (!parsed) return "none";
    if (parsed.version === 1 || typeof parsed.importedFingerprint !== "string")
      return "legacy";
    return parsed.importedFingerprint === fingerprint(importedLeague)
      ? "match"
      : "mismatch";
  } catch {
    return "legacy";
  }
}

export function resolveLeagueConfig(
  draftId: string,
  importedLeague: LeagueConfig,
): LeagueConfig {
  return loadLeagueConfig(draftId) ?? importedLeague;
}
