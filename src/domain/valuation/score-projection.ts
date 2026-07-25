import type { Position, ScoringRules } from "../league/types";
import type { ProjectionStats } from "../players/types";

function statValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function scoreProjection(
  stats: ProjectionStats,
  scoring: ScoringRules,
  position: Position,
): number {
  const receptionPoints = scoring.reception + (scoring.positionReceptionBonus[position] ?? 0);
  const total =
    statValue(stats.passYards) * scoring.passYard +
    statValue(stats.passTds) * scoring.passTd +
    statValue(stats.interceptions) * scoring.interception +
    statValue(stats.rushYards) * scoring.rushYard +
    statValue(stats.rushTds) * scoring.rushTd +
    statValue(stats.receptions) * receptionPoints +
    statValue(stats.receivingYards) * scoring.receivingYard +
    statValue(stats.receivingTds) * scoring.receivingTd +
    statValue(stats.fumblesLost) * scoring.fumbleLost;

  return Math.round(total * 10) / 10;
}
