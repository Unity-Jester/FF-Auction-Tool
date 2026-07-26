import {
  createLeagueConfig,
  type CreateLeagueConfigInput,
} from "@/domain/league/defaults";
import type { LeagueConfig } from "@/domain/league/types";

const key = (draftId: string) => `sleeper-auction-companion:league:${draftId}`;
export function saveLeagueConfig(draftId: string, league: LeagueConfig) {
  try {
    localStorage.setItem(key(draftId), JSON.stringify({ version: 1, league }));
  } catch {}
}
export function loadLeagueConfig(draftId: string): LeagueConfig | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(draftId)) ?? "null");
    if (!parsed || parsed.version !== 1) return null;
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
