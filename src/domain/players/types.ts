import type { Position } from "../league/types";

export type ProjectionStats = {
  passYards?: number;
  passTds?: number;
  interceptions?: number;
  rushYards?: number;
  rushTds?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTds?: number;
  fumblesLost?: number;
};

export type PlayerProjection = {
  playerId: string;
  name: string;
  team: string | null;
  positions: Position[];
  stats: ProjectionStats;
  source: string;
  updatedAt: string;
};
