import type { Position } from "../league/types";

export type PlayerPreference = "target" | "avoid" | "lock" | "neutral";

export type StrategyConfig = {
  id: string;
  name: string;
  archetype: "recommended" | "balanced" | "stars-and-scrubs" | "custom";
  starterBudgetShare: number;
  positionBudgets: Record<Position, number>;
  spendingCurve: number[];
  qbApproach: "auto" | "elite" | "value";
  teApproach: "auto" | "elite" | "value";
  rbBuild: "auto" | "hero" | "zero";
  minReserve: number;
  preferences: Record<string, PlayerPreference>;
  projectionOverrides: Record<string, number>;
  valueOverrides: Record<string, number>;
};
