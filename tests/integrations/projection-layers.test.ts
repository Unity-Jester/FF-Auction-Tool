import { describe, expect, it } from "vitest";

import type { PlayerProjection } from "@/domain/players/types";
import {
  INDIVIDUAL_PROJECTION_SOURCE,
  mergeProjectionLayers,
} from "@/integrations/projections/merge-layers";

const base: PlayerProjection = {
  playerId: "same-player",
  name: "Same Player",
  team: "DET",
  positions: ["WR"],
  stats: { receptions: 70, receivingYards: 1_000 },
  source: "Recorded fixture",
  updatedAt: "2026-07-01T00:00:00.000Z",
};
const csv: PlayerProjection = {
  ...base,
  stats: { receptions: 90, receivingYards: 1_200 },
  source: "CSV override",
  updatedAt: "2026-07-02T00:00:00.000Z",
};
const individual: PlayerProjection = {
  ...base,
  stats: { receptions: 110 },
  source: INDIVIDUAL_PROJECTION_SOURCE,
  updatedAt: "2026-07-03T00:00:00.000Z",
};

describe("mergeProjectionLayers", () => {
  it.each([
    [csv, individual],
    [individual, csv],
  ])(
    "keeps the individual layer active regardless of override import order",
    (...overrides) => {
      const merged = mergeProjectionLayers([base], overrides);

      expect(merged).toEqual([
        expect.objectContaining({
          playerId: "same-player",
          source: INDIVIDUAL_PROJECTION_SOURCE,
          stats: {
            receptions: 110,
            receivingYards: 1_200,
          },
        }),
      ]);
    },
  );
});
