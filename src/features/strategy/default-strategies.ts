import type { LeagueConfig, Position } from "@/domain/league/types";
import type { StrategyConfig } from "@/domain/strategy/types";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const splits: Record<StrategyConfig["archetype"], number[]> = {
  recommended: [0.12, 0.27, 0.3, 0.14, 0.02, 0.02],
  balanced: [0.13, 0.26, 0.29, 0.14, 0.02, 0.02],
  "stars-and-scrubs": [0.11, 0.29, 0.34, 0.13, 0.01, 0.01],
  custom: [0.12, 0.27, 0.3, 0.14, 0.02, 0.02],
};

export function defaultStrategy(
  league: LeagueConfig,
  archetype: StrategyConfig["archetype"] = "recommended",
): StrategyConfig {
  const spend = league.budget;
  const shares = splits[archetype];
  const budgets = Object.fromEntries(
    positions.map((position, index) => [
      position,
      Math.floor(spend * shares[index]),
    ]),
  ) as Record<Position, number>;
  budgets.WR +=
    spend - Object.values(budgets).reduce((total, value) => total + value, 0);
  return {
    id: archetype.replaceAll("-", "_"),
    name:
      archetype === "stars-and-scrubs"
        ? "Stars and scrubs"
        : archetype[0].toUpperCase() + archetype.slice(1),
    archetype,
    starterBudgetShare: archetype === "stars-and-scrubs" ? 0.78 : 0.68,
    positionBudgets: budgets,
    spendingCurve:
      archetype === "stars-and-scrubs"
        ? [1.5, 1.28, 1.05, 0.86, 0.68, 0.54]
        : archetype === "balanced"
          ? [1.05, 1, 0.96, 0.9, 0.82, 0.72]
          : [1.2, 1.08, 0.98, 0.88, 0.76, 0.64],
    qbApproach: "auto",
    teApproach: "auto",
    rbBuild: "auto",
    minReserve: league.rosterSize * league.minBid,
    preferences: {},
    projectionOverrides: {},
    valueOverrides: {},
  };
}
