import type { PlayerProjection } from "@/domain/players/types";

export const INDIVIDUAL_PROJECTION_SOURCE =
  "Individual projection override";

export function mergeProjectionLayers(
  baseline: ReadonlyArray<PlayerProjection>,
  overrides: ReadonlyArray<PlayerProjection>,
): PlayerProjection[] {
  const merged = new Map(
    baseline.map((projection) => [
      projection.playerId,
      {
        ...projection,
        positions: [...projection.positions],
        stats: { ...projection.stats },
      },
    ]),
  );
  const csvOverrides = overrides.filter(
    (projection) => projection.source !== INDIVIDUAL_PROJECTION_SOURCE,
  );
  const individualOverrides = overrides.filter(
    (projection) => projection.source === INDIVIDUAL_PROJECTION_SOURCE,
  );

  [...csvOverrides, ...individualOverrides].forEach((projection) => {
    const current = merged.get(projection.playerId);
    merged.set(projection.playerId, {
      ...(current ?? projection),
      ...projection,
      positions: [...projection.positions],
      stats: {
        ...(current?.stats ?? {}),
        ...projection.stats,
      },
    });
  });

  return [...merged.values()].sort((left, right) =>
    left.playerId.localeCompare(right.playerId),
  );
}
