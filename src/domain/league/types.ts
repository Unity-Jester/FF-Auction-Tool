export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export type FlexSlot = {
  count: number;
  eligible: Position[];
};

export type ScoringRules = {
  passYard: number;
  passTd: number;
  interception: number;
  rushYard: number;
  rushTd: number;
  reception: number;
  receivingYard: number;
  receivingTd: number;
  fumbleLost: number;
  positionReceptionBonus: Partial<Record<Position, number>>;
};

export type LeagueConfig = {
  teams: number;
  budget: number;
  minBid: number;
  starters: Record<Position, number>;
  bench: number;
  rosterSize: number;
  flex: FlexSlot[];
  scoring: ScoringRules;
  capKickerDefenseAtOne: boolean;
};
