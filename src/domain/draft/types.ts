import type { LeagueConfig } from "../league/types";

export type DraftPurchase = {
  draftId: string;
  playerId: string;
  rosterId: number;
  amount: number;
  pickNo: number;
  createdAt: string | null;
  source: "sleeper" | "local";
  keeper: boolean;
};

export type TeamDraftState = {
  rosterId: number;
  name: string;
  remainingBudget: number;
  openSlots: number;
  playerIds: string[];
  /** Authoritative roster ownership for which Sleeper supplies no auction price. */
  unknownCostPlayerIds?: string[];
};

export type DraftSnapshot = {
  draftId: string;
  status: "pre" | "drafting" | "complete";
  type: "auction";
  league: LeagueConfig;
  teams: TeamDraftState[];
  purchases: DraftPurchase[];
  lastUpdatedAt: string;
};
