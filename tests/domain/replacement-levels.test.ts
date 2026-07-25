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

  it("uses a multi-position player where needed without counting that identity twice", () => {
    const config = league({ starters: { RB: 1, WR: 1 } });
    const players: ScoredPlayer[] = [
      { playerId: "dual", positions: ["RB", "WR"], points: 100 },
      { playerId: "rb-only", positions: ["RB"], points: 90 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.replacementPlayerIds).toMatchObject({
      RB: "rb-only",
      WR: "dual",
    });
    expect(result.starterPoints).toMatchObject({ RB: 90, WR: 100 });
    expect(
      new Set(
        Object.values(result.replacementPlayerIds).filter(
          (playerId): playerId is string => playerId !== undefined,
        ),
      ).size,
    ).toBe(2);
  });

  it("canonicalizes duplicate IDs by unioning positions and keeping the highest finite points", () => {
    const config = league({ starters: { RB: 1, WR: 1 } });
    const players: ScoredPlayer[] = [
      { playerId: "duplicate", positions: ["WR"], points: 80 },
      { playerId: "rb-only", positions: ["RB"], points: 90 },
      { playerId: "duplicate", positions: ["RB"], points: 100 },
      { playerId: "duplicate", positions: ["TE"], points: Number.NaN },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.replacementPlayerIds).toMatchObject({
      RB: "rb-only",
      WR: "duplicate",
    });
    expect(result.starterPoints).toMatchObject({ RB: 90, WR: 100 });
    expect(
      Object.values(result.replacementPlayerIds).filter(
        (playerId) => playerId === "duplicate",
      ),
    ).toHaveLength(1);
  });

  it("unions duplicate positions separately from choosing a finite score", () => {
    const config = league({ starters: { RB: 1, WR: 1 } });
    const players: ScoredPlayer[] = [
      { playerId: "duplicate", positions: ["WR"], points: Number.NaN },
      { playerId: "rb-only", positions: ["RB"], points: 90 },
      { playerId: "duplicate", positions: ["RB"], points: 100 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.replacementPlayerIds).toMatchObject({
      RB: "rb-only",
      WR: "duplicate",
    });
    expect(result.starterPoints).toMatchObject({ RB: 90, WR: 100 });
  });

  it("preserves bench slots without starter demand and lets ranks exceed supply", () => {
    const config = league({ teams: 2, bench: 3 });
    const players: ScoredPlayer[] = [
      { playerId: "qb", positions: ["QB"], points: 100 },
      { playerId: "rb", positions: ["RB"], points: 90 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.benchRanks).toEqual({
      QB: 3,
      RB: 3,
      WR: 0,
      TE: 0,
      K: 0,
      DEF: 0,
    });
    expect(
      Object.values(result.benchRanks).reduce((sum, rank) => sum + rank, 0),
    ).toBe(6);
    expect(result.benchPoints.QB).toBe(0);
    expect(result.benchPoints.RB).toBe(0);
  });

  it.each([
    [
      "broad flex first",
      [
        { count: 1, eligible: ["RB", "WR"] as Position[] },
        { count: 1, eligible: ["RB"] as Position[] },
      ],
    ],
    [
      "narrow flex first",
      [
        { count: 1, eligible: ["RB"] as Position[] },
        { count: 1, eligible: ["RB", "WR"] as Position[] },
      ],
    ],
  ])("optimizes overlapping flex categories with %s", (_, flex) => {
    const config = league({ flex });
    const players: ScoredPlayer[] = [
      { playerId: "rb-low", positions: ["RB"], points: 10 },
      { playerId: "wr-high", positions: ["WR"], points: 90 },
      { playerId: "rb-high", positions: ["RB"], points: 100 },
    ];

    for (const orderedPlayers of [players, [...players].reverse(), players]) {
      const result = calculateReplacementLevels({
        league: config,
        players: orderedPlayers,
      });

      expect(result.starterRanks).toMatchObject({ RB: 1, WR: 1 });
      expect(result.starterPoints).toMatchObject({ RB: 100, WR: 90 });
      expect(result.replacementPlayerIds).toMatchObject({
        RB: "rb-high",
        WR: "wr-high",
      });
    }
  });

  it("breaks exact largest-remainder bench ties by position order", () => {
    const config = league({
      starters: { QB: 1, RB: 1, WR: 1 },
      bench: 2,
    });
    const players = [
      ...scored("QB", [100, 90]),
      ...scored("RB", [100, 90]),
      ...scored("WR", [100, 90]),
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.benchRanks).toMatchObject({ QB: 2, RB: 2, WR: 1 });
  });

  it("stops allocating flex ranks when all eligible identity supply is exhausted", () => {
    const config = league({
      flex: [{ count: 3, eligible: ["RB", "WR"] }],
    });
    const players: ScoredPlayer[] = [
      { playerId: "dual", positions: ["RB", "WR"], points: 100 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.starterRanks.RB + result.starterRanks.WR).toBe(1);
    expect(Object.values(result.replacementPlayerIds)).toEqual(["dual"]);
  });

  it("relocates a multi-position player to fixed demand before consuming flex capacity", () => {
    const config = league({
      starters: { RB: 1, WR: 1 },
      flex: [{ count: 1, eligible: ["RB"] }],
    });
    const players: ScoredPlayer[] = [
      { playerId: "dual", positions: ["RB", "WR"], points: 100 },
      { playerId: "rb-only", positions: ["RB"], points: 90 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.starterRanks).toMatchObject({ RB: 1, WR: 1 });
    expect(result.replacementPlayerIds).toMatchObject({
      RB: "rb-only",
      WR: "dual",
    });
  });

  it("orders equally constrained flex categories by position order", () => {
    const config = league({
      flex: [
        { count: 1, eligible: ["DEF"] },
        { count: 1, eligible: ["K"] },
      ],
    });
    const players: ScoredPlayer[] = [
      { playerId: "specialist", positions: ["K", "DEF"], points: 100 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.starterRanks).toMatchObject({ K: 1, DEF: 0 });
    expect(result.replacementPlayerIds).toMatchObject({ K: "specialist" });
  });

  it("falls back to kicker and defense supply for a bench-only league", () => {
    const config = league({ bench: 3 });
    const players: ScoredPlayer[] = [
      { playerId: "def", positions: ["DEF"], points: 80 },
      { playerId: "k", positions: ["K"], points: 90 },
    ];

    const result = calculateReplacementLevels({ league: config, players });

    expect(result.benchRanks).toEqual({
      QB: 0,
      RB: 0,
      WR: 0,
      TE: 0,
      K: 2,
      DEF: 1,
    });
    expect(result.benchPoints.K).toBe(0);
    expect(result.benchPoints.DEF).toBe(80);
  });
});
