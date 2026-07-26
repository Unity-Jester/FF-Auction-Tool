import type { Position } from "@/domain/league/types";
import type { PlayerProjection, ProjectionStats } from "@/domain/players/types";

export type ProjectionSnapshot = {
  source: string;
  updatedAt: string;
  projections: PlayerProjection[];
  stale: boolean;
};

export type ProjectionSnapshotData = Omit<ProjectionSnapshot, "stale">;

export type ProjectionPlayer = Pick<PlayerProjection, "playerId" | "name" | "team"> & {
  positions: readonly Position[];
};

export type CsvProjectionRow = {
  sourceName: string;
  playerId?: string;
  team?: string;
  position?: Position;
  stats?: ProjectionStats;
  reason?: string;
};

export type CsvProjectionResult = {
  matched: PlayerProjection[];
  unmatched: CsvProjectionRow[];
  ambiguous: (CsvProjectionRow & { candidates: string[] })[];
  unsupported: CsvProjectionRow[];
};
