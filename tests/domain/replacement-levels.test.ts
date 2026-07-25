import { describe, expect, it } from "vitest";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";
import {
  calculateReplacementLevels,
  type ScoredPlayer,
} from "@/domain/valuation/replacement-levels";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

function league(overrides: {
  teams?: number;
  starters?: Partial<Record<Position, number>>;
  bench?: number;
  flex?: Array<{ count: number; eligible: Position[] }>;
}) {
  return createLeagueConfig({
    teams: overrides.teams ?? 1,
    budget: 1_000,
    starters: Object.fromEntries(
      positions.map((position) => [
        position,
        overrides.starters?.[position] ?? 0,
      ]),
    ) as Record<Position, number>,
    bench: overrides.bench ?? 0,
    flex: overrides.flex ?? [],
    receptionPoints: 0.5,
  });
}

function scored(position: Position, points: number[]): ScoredPlayer[] {
  return points.map((projection, index) => ({
    playerId: `${position.toLowerCase()}-${index + 1}`,
    positions: [position],
    points: projection,
  }));
}

describe("calculateReplacementLevels", () => {
  it("allocates flex starters by remaining supply and preserves every bench slot", () => {
    const config = league({
      teams: 4,
      starters: { QB: 1, RB: 1, WR: 1, TE: 1 },
      flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
      bench: 2,
    });
    const players = [
      ...scored("QB", [200, 190, 180, 170, 160, 150]),
      ...scored("RB", [190, 180, 170, 160, 150, 130, 120, 110]),
      ...scored("WR", [188, 178, 168, 158, 140, 135, 125, 115]),
      ...scored("TE", [170, 160, 150, 140, 100, 90]),
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.starterRanks).toEqual({
      QB: 4,
      RB: 6,
      WR: 6,
      TE: 4,
      K: 0,
      DEF: 0,
    });
    expect(
      Object.values(result.benchRanks).reduce((sum, rank) => sum + rank, 0),
    ).toBe(28);
    expect(result.benchRanks.RB).toBeGreaterThanOrEqual(result.starterRanks.RB);
    expect(result.benchRanks.WR).toBeGreaterThanOrEqual(result.starterRanks.WR);
  });

  it("removes drafted players before choosing replacement points and IDs", () => {
    const config = league({ starters: { QB: 1 } });
    const players = scored("QB", [100, 90, 80]);

    const result = calculateReplacementLevels({
      league: config,
      players,
      draftedPlayerIds: new Set(["qb-1"]),
    });

    expect(result.starterPoints.QB).toBe(90);
    expect(result.benchPoints.QB).toBe(90);
    expect(result.replacementPlayerIds.QB).toBe("qb-2");
  });

  it("raises quarterback demand when quarterbacks win superflex openings", () => {
    const config = league({
      teams: 2,
      starters: { QB: 1, RB: 1 },
      flex: [{ count: 1, eligible: ["QB", "RB"] }],
    });
    const players = [
      ...scored("QB", [200, 190, 180, 170]),
      ...scored("RB", [160, 150, 100, 90]),
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.starterRanks.QB).toBe(4);
    expect(result.starterRanks.RB).toBe(2);
  });

  it("breaks flex ties by position order and pool ties by player ID", () => {
    const config = league({
      starters: { QB: 1 },
      flex: [{ count: 1, eligible: ["WR", "RB"] }],
    });
    const players: ScoredPlayer[] = [
      { playerId: "qb-b", positions: ["QB"], points: 100 },
      { playerId: "qb-a", positions: ["QB"], points: 100 },
      { playerId: "wr-a", positions: ["WR"], points: 90 },
      { playerId: "rb-a", positions: ["RB"], points: 90 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.starterRanks.RB).toBe(1);
    expect(result.starterRanks.WR).toBe(0);
    expect(result.replacementPlayerIds.QB).toBe("qb-a");
  });

  it("returns zero points when demand exceeds the available player pool", () => {
    const config = league({ teams: 2, starters: { QB: 1, TE: 1 } });

    const result = calculateReplacementLevels({
      league: config,
      players: scored("QB", [100]),
    });

    expect(result.starterRanks.QB).toBe(2);
    expect(result.starterPoints.QB).toBe(0);
    expect(result.starterPoints.TE).toBe(0);
    expect(result.replacementPlayerIds.QB).toBeUndefined();
  });

  it("does not mutate league, player, position, or drafted-ID inputs", () => {
    const config = league({
      teams: 2,
      starters: { RB: 1, WR: 1 },
      flex: [{ count: 1, eligible: ["RB", "WR"] }],
      bench: 1,
    });
    const players: ScoredPlayer[] = [
      { playerId: "dual", positions: ["RB", "WR"], points: 100 },
      ...scored("RB", [90, 80, 70]),
      ...scored("WR", [85, 75, 65]),
    ];
    const draftedPlayerIds = new Set(["rb-3"]);
    const leagueBefore = structuredClone(config);
    const playersBefore = structuredClone(players);
    const draftedBefore = [...draftedPlayerIds];

    calculateReplacementLevels({ league: config, players, draftedPlayerIds });

    expect(config).toEqual(leagueBefore);
    expect(players).toEqual(playersBefore);
    expect([...draftedPlayerIds]).toEqual(draftedBefore);
  });

  it("ignores non-finite projections and players without a supported position", () => {
    const config = league({ starters: { RB: 1 } });
    const players = [
      { playerId: "nan", positions: ["RB"], points: Number.NaN },
      {
        playerId: "infinity",
        positions: ["RB"],
        points: Number.POSITIVE_INFINITY,
      },
      { playerId: "unsupported", positions: ["INVALID"], points: 1_000 },
      { playerId: "rb-valid", positions: ["INVALID", "RB"], points: 50 },
    ] as unknown as ScoredPlayer[];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.starterPoints.RB).toBe(50);
    expect(result.replacementPlayerIds.RB).toBe("rb-valid");
  });
});
