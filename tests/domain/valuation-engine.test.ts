import { describe, expect, it } from "vitest";
import type { DraftPurchase, TeamDraftState } from "@/domain/draft/types";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";
import type { StrategyConfig } from "@/domain/strategy/types";
import { calculateBaseValues } from "@/domain/valuation/base-values";
import { calculatePositionScarcity } from "@/domain/valuation/adjust-values";
import {
  runValuationEngine,
  runValuationEngineWithMetadata,
  type PlayerValuation,
  type RunValuationEngineInput,
} from "@/domain/valuation/engine";
import {
  calculateReplacementLevels,
  type ReplacementLevels,
  type ScoredPlayer,
} from "@/domain/valuation/replacement-levels";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

function player(id: string, position: Position, points: number): ScoredPlayer {
  return { playerId: id, positions: [position], points };
}

function purchase(
  playerId: string,
  rosterId: number,
  amount: number,
  pickNo: number,
): DraftPurchase {
  return {
    draftId: "draft",
    playerId,
    rosterId,
    amount,
    pickNo,
    createdAt: null,
    source: "local",
    keeper: false,
  };
}

function strategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    id: "test",
    name: "Test",
    archetype: "recommended",
    starterBudgetShare: 0.75,
    positionBudgets: {
      QB: 15,
      RB: 40,
      WR: 35,
      TE: 20,
      K: 5,
      DEF: 5,
    },
    spendingCurve: [],
    qbApproach: "auto",
    teApproach: "auto",
    rbBuild: "auto",
    minReserve: 5,
    preferences: {},
    projectionOverrides: {},
    valueOverrides: {},
    ...overrides,
  };
}

function levels(): ReplacementLevels {
  const zeroes = Object.fromEntries(
    positions.map((position) => [position, 0]),
  ) as Record<Position, number>;
  const availableRanks = Object.fromEntries(
    positions.map((position) => [position, 100]),
  ) as Record<Position, number>;
  return {
    starterRanks: { ...availableRanks },
    benchRanks: { ...availableRanks },
    starterPoints: { ...zeroes },
    benchPoints: { ...zeroes },
    replacementPlayerIds: {},
  };
}

function input(
  strategyOverrides: Partial<StrategyConfig> = {},
  other: Partial<RunValuationEngineInput> = {},
): RunValuationEngineInput {
  const players = [
    player("rb-1", "RB", 200),
    player("rb-2", "RB", 180),
    player("rb-3", "RB", 160),
    player("rb-4", "RB", 140),
    player("wr-1", "WR", 190),
    player("wr-2", "WR", 170),
    player("wr-3", "WR", 150),
    player("wr-4", "WR", 130),
    player("qb-1", "QB", 240),
    player("qb-2", "QB", 210),
    player("te-1", "TE", 150),
    player("te-2", "TE", 120),
    player("owned-rb", "RB", 175),
    player("owned-wr", "WR", 165),
  ];
  const teams: TeamDraftState[] = [
    {
      rosterId: 1,
      name: "Me",
      remainingBudget: 100,
      openSlots: 4,
      playerIds: ["owned-rb"],
    },
    {
      rosterId: 2,
      name: "Them",
      remainingBudget: 100,
      openSlots: 4,
      playerIds: ["owned-wr"],
    },
  ];
  const league = createLeagueConfig({
    teams: 2,
    budget: 120,
    minBid: 1,
    starters: { QB: 1, RB: 1, WR: 1, TE: 1, K: 0, DEF: 0 },
    bench: 1,
    flex: [],
    receptionPoints: 0.5,
    capKickerDefenseAtOne: false,
  });
  return {
    league,
    strategy: strategy(strategyOverrides),
    players,
    teams,
    replacementLevels: levels(),
    myRosterId: 1,
    purchases: [purchase("owned-rb", 1, 20, 1), purchase("owned-wr", 2, 18, 2)],
    ...other,
  };
}

function adjustmentPercent(
  result: ReturnType<typeof runValuationEngine>,
  playerId: string,
  code: string,
): number {
  const value = result.get(playerId)!;
  return (
    (value.adjustments
      .filter((adjustment) => adjustment.code === code)
      .reduce((sum, adjustment) => sum + adjustment.delta, 0) /
      value.baseValue) *
    100
  );
}

describe("runValuationEngine", () => {
  it("forms tiers from meaningful adjacent value gaps and reports remaining supply", () => {
    const values = [100, 94, 89, 55].map((baseValue, index) => ({
      playerId: `tier-${index + 1}`,
      position: "RB" as const,
      points: 200 - index,
      starterVorp: 1,
      benchVorp: 1,
      blendedVorp: 1,
      baseValue,
      displayValue: baseValue,
      inflationMultiplier: 1,
    }));

    const scarcity = calculatePositionScarcity(values);

    expect(scarcity.groups).toEqual([
      {
        tier: "ELITE",
        supply: 3,
        highestValue: 100,
        lowestValue: 89,
      },
      {
        tier: "HIGH",
        supply: 1,
        highestValue: 55,
        lowestValue: 55,
      },
    ]);
  });

  it("applies exact target, avoid, and lock preference directions", () => {
    const result = runValuationEngine(
      input({
        preferences: {
          "rb-1": "target",
          "rb-2": "avoid",
          "rb-3": "lock",
        },
      }),
    );

    expect(adjustmentPercent(result, "rb-1", "TARGET")).toBeCloseTo(8, 1);
    expect(adjustmentPercent(result, "rb-2", "AVOID")).toBeCloseTo(-20, 1);
    expect(adjustmentPercent(result, "rb-3", "LOCK")).toBeCloseTo(15, 1);
  });

  it("boosts only the highest available running back for a hero build", () => {
    const result = runValuationEngine(input({ rbBuild: "hero" }));
    const top = result
      .get("rb-1")!
      .adjustments.find((adjustment) => adjustment.code === "SPENDING_CURVE");
    const second = result
      .get("rb-2")!
      .adjustments.find((adjustment) => adjustment.label.includes("Hero RB"));

    expect(top?.label).toContain("Hero RB");
    expect(top!.delta).toBeGreaterThan(0);
    expect(second).toBeUndefined();
  });

  it("reserves minimum bids and never recommends more than the legal bid", () => {
    const result = runValuationEngine(input());
    const value = result.get("rb-1")!;

    expect(value.maximumLegalBid).toBe(97);
    expect(value.recommendedMaxBid).toBeLessThanOrEqual(97);
  });

  it("keeps the hard legal maximum factual while a configured extra reserve lowers the recommendation", () => {
    const low = runValuationEngine(input({ minReserve: 5 })).get("rb-1")!;
    const high = runValuationEngine(input({ minReserve: 25 })).get("rb-1")!;

    expect(low.maximumLegalBid).toBe(97);
    expect(high.maximumLegalBid).toBe(97);
    expect(high.strategyMaximumBid).toBe(low.strategyMaximumBid - 20);
    expect(high.recommendedMaxBid).toBeLessThanOrEqual(high.strategyMaximumBid);
  });

  it.each([
    ["negative", -1],
    ["decimal", 5.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["over budget", 121],
  ])("rejects an invalid strategy reserve: %s", (_, minReserve) => {
    expect(() => runValuationEngine(input({ minReserve }))).toThrow(/reserve/i);
  });

  it("rejects missing, extra, malformed, and non-conserving position budgets", () => {
    const valid = strategy().positionBudgets;
    const cases = [
      { ...valid, RB: -1 },
      { ...valid, WR: Number.NaN },
      { ...valid, TE: 999 },
      { ...valid, RB: 79 },
      Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "K")),
      { ...valid, IDP: 0 },
    ];

    for (const positionBudgets of cases) {
      expect(() =>
        runValuationEngine(
          input({
            positionBudgets: positionBudgets as StrategyConfig["positionBudgets"],
          }),
        ),
      ).toThrow(/position budget/i);
    }
  });

  it("summarizes only the three largest adjustments and includes Target", () => {
    const result = runValuationEngine(
      input({
        archetype: "stars-and-scrubs",
        qbApproach: "elite",
        preferences: { "qb-1": "target" },
        positionBudgets: {
          ...strategy().positionBudgets,
          QB: 70,
          RB: 0,
          WR: 20,
        },
      }),
    );
    const value = result.get("qb-1")!;

    expect(value.adjustments.length).toBeGreaterThan(3);
    expect(value.explanation).toContain("Target");
    expect(value.explanation.split(",")).toHaveLength(3);
  });

  it("moves stars-and-scrubs and balanced values in opposite rank directions", () => {
    const stars = runValuationEngine(input({ archetype: "stars-and-scrubs" }));
    const balanced = runValuationEngine(input({ archetype: "balanced" }));

    expect(adjustmentPercent(stars, "qb-1", "SPENDING_CURVE")).toBeGreaterThan(
      0,
    );
    expect(adjustmentPercent(stars, "rb-3", "SPENDING_CURVE")).toBeLessThan(0);
    expect(adjustmentPercent(balanced, "qb-1", "SPENDING_CURVE")).toBeLessThan(
      0,
    );
    expect(
      adjustmentPercent(balanced, "rb-3", "SPENDING_CURVE"),
    ).toBeGreaterThan(0);
  });

  it("raises an underfunded position goal and lowers an overspent one", () => {
    const under = runValuationEngine(
      input({
        positionBudgets: {
          ...strategy().positionBudgets,
          RB: 0,
          WR: 75,
        },
      }),
    );
    const over = runValuationEngine(
      input({
        positionBudgets: {
          ...strategy().positionBudgets,
          RB: 75,
          WR: 0,
        },
      }),
    );

    expect(adjustmentPercent(under, "wr-1", "POSITION_BUDGET")).toBeGreaterThan(
      0,
    );
    expect(adjustmentPercent(over, "wr-1", "POSITION_BUDGET")).toBeLessThan(0);
  });

  it("adds roster need for an open fixed starter but not a filled position", () => {
    const original = input();
    const result = runValuationEngine({
      ...original,
      league: { ...original.league, bench: 0, rosterSize: 4 },
    });

    expect(
      result.get("wr-1")!.adjustments.some((a) => a.code === "ROSTER_NEED"),
    ).toBe(true);
    expect(
      result.get("rb-1")!.adjustments.some((a) => a.code === "ROSTER_NEED"),
    ).toBe(false);
  });

  it("allocates an open flex slot once and uses that position for need and budget pace", () => {
    const original = input();
    const myTeam = {
      ...original.teams[0],
      remainingBudget: 50,
      openSlots: 1,
      playerIds: ["owned-rb", "qb-1", "wr-1", "te-1"],
    };
    const detailed = runValuationEngineWithMetadata({
      ...original,
      league: {
        ...original.league,
        bench: 0,
        rosterSize: 5,
        flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
      },
      teams: [myTeam, original.teams[1]],
      purchases: [
        purchase("owned-rb", 1, 20, 1),
        purchase("owned-wr", 2, 18, 2),
        purchase("qb-1", 1, 15, 3),
        purchase("wr-1", 1, 10, 4),
        purchase("te-1", 1, 5, 5),
      ],
    });
    const result = detailed.values;

    expect(detailed.metadata.needs.mine).toMatchObject({
      RB: 0,
      WR: 1,
      TE: 0,
    });
    expect(
      result.get("wr-2")!.adjustments.map((adjustment) => adjustment.code),
    ).toEqual(expect.arrayContaining(["ROSTER_NEED", "POSITION_BUDGET"]));
    expect(detailed.metadata.bestFitPositionsByPlayerId["rb-1"]).toEqual([]);
    expect(detailed.metadata.bestFitPositionsByPlayerId["wr-2"]).toEqual([
      "WR",
    ]);
    expect(detailed.metadata.rosterNeeds).toEqual({
      fixed: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
      flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
      bench: 0,
    });
    expect(detailed.metadata.blueprintProgress.openByPosition).toEqual({
      QB: 0,
      RB: 0,
      WR: 0,
      TE: 0,
      K: 0,
      DEF: 0,
    });
    expect(detailed.metadata.tierByPlayerId["rb-1"]).toMatch(
      /ELITE|HIGH|MID|LOW/,
    );
    expect(
      detailed.metadata.remainingSupplyAtOrAboveTierByPlayerId["rb-1"],
    ).toBeGreaterThan(0);
  });

  it("allocates each fixed and bench opening exactly once", () => {
    const original = input();
    const league = createLeagueConfig({
      teams: 1,
      budget: 120,
      minBid: 1,
      starters: { QB: 0, RB: 1, WR: 0, TE: 0, K: 0, DEF: 0 },
      bench: 1,
      flex: [],
      receptionPoints: 0.5,
      capKickerDefenseAtOne: false,
    });
    const build = (players: ScoredPlayer[]) =>
      runValuationEngineWithMetadata({
        ...original,
        league,
        players,
        teams: [
          {
            rosterId: 1,
            name: "Me",
            remainingBudget: 120,
            openSlots: 2,
            playerIds: [],
          },
        ],
        myRosterId: 1,
        purchases: [],
      });

    const forward = build(original.players);
    const reversed = build([...original.players].reverse());

    expect(
      Object.values(forward.metadata.needs.mine).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(2);
    expect(
      Object.values(forward.metadata.needs.league).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(2);
    expect(forward.metadata.needs).toEqual(reversed.metadata.needs);
    expect(forward.metadata.rosterNeeds).toEqual({
      fixed: { QB: 0, RB: 1, WR: 0, TE: 0, K: 0, DEF: 0 },
      flex: [],
      bench: 1,
    });
  });

  it("allocates flexible demand toward the strategy budget without duplicating the opening", () => {
    const original = input();
    const league = createLeagueConfig({
      teams: 1,
      budget: 120,
      minBid: 1,
      starters: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
      bench: 0,
      flex: [{ count: 1, eligible: ["RB", "WR"] }],
      receptionPoints: 0.5,
      capKickerDefenseAtOne: false,
    });
    const run = (positionBudgets: Record<Position, number>) =>
      runValuationEngineWithMetadata({
        ...original,
        league,
        strategy: strategy({ positionBudgets, minReserve: 1 }),
        teams: [
          {
            rosterId: 1,
            name: "Me",
            remainingBudget: 120,
            openSlots: 1,
            playerIds: [],
          },
        ],
        myRosterId: 1,
        purchases: [],
      }).metadata.needs.mine;

    expect(
      run({ QB: 0, RB: 100, WR: 20, TE: 0, K: 0, DEF: 0 }),
    ).toMatchObject({ RB: 1, WR: 0 });
    expect(
      run({ QB: 0, RB: 20, WR: 100, TE: 0, K: 0, DEF: 0 }),
    ).toMatchObject({ RB: 0, WR: 1 });
  });

  it("progresses capacity and dollars through a filled position and full roster", () => {
    const league = createLeagueConfig({
      teams: 1,
      budget: 20,
      minBid: 1,
      starters: { QB: 0, RB: 1, WR: 1, TE: 0, K: 0, DEF: 0 },
      bench: 0,
      flex: [],
      receptionPoints: 0.5,
      capKickerDefenseAtOne: false,
    });
    const players = [
      player("first-rb", "RB", 120),
      player("second-rb", "RB", 110),
      player("needed-wr", "WR", 100),
    ];
    const strategyConfig = strategy({
      positionBudgets: { QB: 0, RB: 10, WR: 10, TE: 0, K: 0, DEF: 0 },
      minReserve: 2,
    });
    const run = (
      playerIds: string[],
      remainingBudget: number,
      openSlots: number,
      purchases: DraftPurchase[],
    ) => {
      const replacementLevels = calculateReplacementLevels({
        league,
        players,
        rosteredPlayerIdsByTeam: [playerIds],
      });
      return runValuationEngine({
        league,
        strategy: strategyConfig,
        players,
        teams: [
          {
            rosterId: 1,
            name: "Me",
            remainingBudget,
            openSlots,
            playerIds,
          },
        ],
        replacementLevels,
        myRosterId: 1,
        purchases,
      });
    };

    const before = run([], 20, 2, []);
    const afterRb = run(
      ["first-rb"],
      15,
      1,
      [purchase("first-rb", 1, 5, 1)],
    );
    const complete = run(
      ["first-rb", "needed-wr"],
      10,
      0,
      [
        purchase("first-rb", 1, 5, 1),
        purchase("needed-wr", 1, 5, 2),
      ],
    );

    expect(
      [...before.values()].reduce(
        (sum, value) => sum + value.displayValue,
        0,
      ),
    ).toBe(20);
    expect(afterRb.get("second-rb")!.displayValue).toBe(0);
    expect(afterRb.get("needed-wr")!.displayValue).toBe(15);
    expect(
      [...complete.values()].every((value) => value.displayValue === 0),
    ).toBe(true);
  });

  it("adds scarcity at the remaining league fixed-starter boundary", () => {
    const scarce = input(
      {},
      {
        players: input().players.filter(
          (candidate) =>
            !candidate.playerId.startsWith("te-") ||
            candidate.playerId === "te-1",
        ),
      },
    );
    const result = runValuationEngine(scarce);

    expect(result.get("te-1")!.adjustments).toContainEqual(
      expect.objectContaining({ code: "SCARCITY" }),
    );
  });

  it("detects elite-tier scarcity even when lower-tier tight ends remain", () => {
    const original = input();
    const extraTightEnds = Array.from({ length: 10 }, (_, index) =>
      player(`te-depth-${index + 1}`, "TE", 60 - index * 4),
    );
    const result = runValuationEngine({
      ...original,
      players: [
        ...original.players.map((candidate) =>
          candidate.playerId === "te-2"
            ? { ...candidate, points: 60 }
            : candidate,
        ),
        ...extraTightEnds,
      ],
      teams: original.teams.map((team) => ({
        ...team,
        openSlots: 8,
      })),
    });
    const positiveTightEnds = [...result.values()].filter(
      (value) => value.position === "TE" && value.baseValue > 0,
    );

    expect(positiveTightEnds.length).toBeGreaterThan(2);
    expect(result.get("te-1")!.adjustments).toContainEqual(
      expect.objectContaining({ code: "SCARCITY" }),
    );
  });

  it("excludes zero-value players from tier scarcity supply", () => {
    const original = input();
    const zeroValueTightEnds = Array.from({ length: 8 }, (_, index) =>
      player(`te-zero-${index + 1}`, "TE", 0),
    );
    const result = runValuationEngine({
      ...original,
      players: [...original.players, ...zeroValueTightEnds],
    });

    expect(result.get("te-1")!.adjustments).toContainEqual(
      expect.objectContaining({ code: "SCARCITY" }),
    );
    for (const candidate of zeroValueTightEnds) {
      expect(result.get(candidate.playerId)!.baseValue).toBe(0);
      expect(
        result
          .get(candidate.playerId)!
          .adjustments.some((adjustment) => adjustment.code === "SCARCITY"),
      ).toBe(false);
    }
  });

  it("does not add tier scarcity when league fixed demand is fully filled", () => {
    const original = input();
    const ownedTightEnds = [
      player("owned-te-me", "TE", Number.NaN),
      player("owned-te-them", "TE", Number.NaN),
    ];
    const zeroTightEnd = player("te-zero", "TE", 0);
    const result = runValuationEngine({
      ...original,
      league: { ...original.league, bench: 0, rosterSize: 4 },
      players: [
        ...original.players.map((candidate) =>
          candidate.playerId === "te-2"
            ? { ...candidate, points: 20 }
            : candidate,
        ),
        ...ownedTightEnds,
        zeroTightEnd,
      ],
      teams: original.teams.map((team) => ({
        ...team,
        playerIds: [
          ...team.playerIds,
          team.rosterId === 1 ? "owned-te-me" : "owned-te-them",
        ],
      })),
    });

    for (const playerId of ["te-1", "te-2", "te-zero"]) {
      expect(
        result
          .get(playerId)!
          .adjustments.some((adjustment) => adjustment.code === "SCARCITY"),
      ).toBe(false);
    }
  });

  it("uses an authoritative rostered keeper to fill a fixed starter slot", () => {
    const original = input();
    const keeper = player("keeper-te", "TE", Number.NaN);
    const result = runValuationEngine({
      ...original,
      league: { ...original.league, bench: 0, rosterSize: 4 },
      players: [...original.players, keeper],
      teams: original.teams.map((team) =>
        team.rosterId === 1
          ? {
              ...team,
              openSlots: 3,
              playerIds: [...team.playerIds, keeper.playerId],
            }
          : { ...team, openSlots: 5 },
      ),
    });

    for (const playerId of ["te-1", "te-2"]) {
      const adjustmentCodes = result
        .get(playerId)!
        .adjustments.map((adjustment) => adjustment.code);
      expect(adjustmentCodes).not.toContain("ROSTER_NEED");
      expect(adjustmentCodes).not.toContain("POSITION_BUDGET");
    }
  });

  it("assigns a multi-position keeper once using fixed need and position order", () => {
    const original = input();
    const keeper: ScoredPlayer = {
      playerId: "keeper-rb-wr",
      positions: ["WR", "RB"],
      points: 145,
    };
    const result = runValuationEngine({
      ...original,
      league: { ...original.league, bench: 0, rosterSize: 4 },
      players: [...original.players, keeper],
      teams: original.teams.map((team) =>
        team.rosterId === 1 ? { ...team, playerIds: [keeper.playerId] } : team,
      ),
      purchases: [purchase("owned-wr", 2, 18, 1)],
    });

    expect(
      result
        .get("rb-1")!
        .adjustments.some((adjustment) => adjustment.code === "ROSTER_NEED"),
    ).toBe(false);
    expect(
      result
        .get("wr-1")!
        .adjustments.some((adjustment) => adjustment.code === "ROSTER_NEED"),
    ).toBe(true);
  });

  it("maximizes fixed slots when several keepers have overlapping eligibility", () => {
    const original = input();
    const keepers: ScoredPlayer[] = [
      { playerId: "A", positions: ["QB", "RB"], points: Number.NaN },
      { playerId: "B", positions: ["QB", "WR"], points: Number.NaN },
      { playerId: "C", positions: ["QB", "WR"], points: Number.NaN },
    ];
    const run = (reverse: boolean) =>
      runValuationEngine({
        ...original,
        league: {
          ...original.league,
          bench: 0,
          rosterSize: 3,
          starters: { QB: 1, RB: 1, WR: 1, TE: 0, K: 0, DEF: 0 },
        },
        players: reverse
          ? [...keepers, ...original.players].reverse()
          : [...original.players, ...keepers],
        teams: original.teams
          .map((team) =>
            team.rosterId === 1
              ? {
                  ...team,
                  playerIds: reverse
                    ? keepers.map((keeper) => keeper.playerId).reverse()
                    : keepers.map((keeper) => keeper.playerId),
                }
              : team,
          )
          .reverse(),
        purchases: [purchase("owned-wr", 2, 18, 1)],
      });

    for (const result of [run(false), run(true)]) {
      for (const playerId of ["qb-1", "rb-1", "wr-1"]) {
        expect(
          result
            .get(playerId)!
            .adjustments.some(
              (adjustment) => adjustment.code === "ROSTER_NEED",
            ),
        ).toBe(false);
      }
    }
  });

  it("counts keeper occupancy without inventing known position spend", () => {
    const original = input();
    const keeper = player("keeper-te-spend", "TE", Number.NaN);
    const common = {
      ...original,
      league: {
        ...original.league,
        starters: { ...original.league.starters, TE: 2 },
      },
      players: [...original.players, keeper],
      teams: original.teams.map((team) =>
        team.rosterId === 1
          ? { ...team, playerIds: [...team.playerIds, keeper.playerId] }
          : team,
      ),
    };
    const expectedRemainingTeValue = Math.max(
      ...[...calculateBaseValues(common).values()]
        .filter((value) => value.position === "TE")
        .map((value) => value.baseValue),
    );
    const teBudget = Math.round(expectedRemainingTeValue);
    const positionBudgets = {
      ...common.strategy.positionBudgets,
      TE: teBudget,
      WR: common.strategy.positionBudgets.WR +
        common.strategy.positionBudgets.TE -
        teBudget,
    };
    const withoutPurchase = runValuationEngine({
      ...common,
      strategy: { ...common.strategy, positionBudgets },
    });
    const withPurchase = runValuationEngine({
      ...common,
      strategy: { ...common.strategy, positionBudgets },
      purchases: [...common.purchases, purchase(keeper.playerId, 1, 10, 3)],
    });

    const withoutDelta =
      withoutPurchase
        .get("te-1")!
        .adjustments.find(
          (adjustment) => adjustment.code === "POSITION_BUDGET",
        )?.delta ?? 0;
    const withDelta =
      withPurchase
        .get("te-1")!
        .adjustments.find(
          (adjustment) => adjustment.code === "POSITION_BUDGET",
        )?.delta ?? 0;
    expect(Math.abs(withoutDelta)).toBeLessThan(1);
    expect(withDelta).toBeLessThan(withoutDelta);
  });

  it("uses a valid manual override exactly and rejects an invalid override", () => {
    const result = runValuationEngine(
      input({ valueOverrides: { "rb-1": 42.25 } }),
    );
    expect(result.get("rb-1")!.adjustedValue).toBe(42.25);
    expect(result.get("rb-1")!.adjustments).toContainEqual(
      expect.objectContaining({ code: "MANUAL" }),
    );

    expect(() =>
      runValuationEngine(input({ valueOverrides: { "rb-1": -1 } })),
    ).toThrow(/override/i);
  });

  it("rounds a manual override before storing it and calculating its delta", () => {
    const withoutOverride = runValuationEngine(input()).get("rb-1")!;
    const overridden = runValuationEngine(
      input({ valueOverrides: { "rb-1": 42.257 } }),
    ).get("rb-1")!;
    const manual = overridden.adjustments.find(
      (adjustment) => adjustment.code === "MANUAL",
    )!;

    expect(overridden.adjustedValue).toBe(42.26);
    expect(manual.delta).toBe(
      Math.round((42.26 - withoutOverride.adjustedValue) * 100) / 100,
    );
  });

  it("clamps combined percentage changes in both directions", () => {
    const up = runValuationEngine(
      input({
        archetype: "stars-and-scrubs",
        qbApproach: "elite",
        preferences: { "qb-1": "lock" },
        positionBudgets: {
          ...strategy().positionBudgets,
          QB: 90,
          RB: 0,
          WR: 0,
        },
      }),
    ).get("qb-1")!;
    const down = runValuationEngine(
      input({
        archetype: "custom",
        spendingCurve: [0],
        qbApproach: "value",
        preferences: { "qb-1": "avoid" },
        positionBudgets: {
          ...strategy().positionBudgets,
          QB: 0,
          RB: 55,
        },
      }),
    ).get("qb-1")!;

    expect(up.adjustedValue).toBeCloseTo(up.baseValue * 1.35, 2);
    expect(down.adjustedValue).toBeLessThan(down.baseValue);
    const adjustmentCents = (value: PlayerValuation) =>
      Math.round(
        value.adjustments.reduce(
          (sum, adjustment) => sum + adjustment.delta,
          0,
        ) * 100,
      );
    expect(adjustmentCents(up)).toBe(
      Math.round((up.adjustedValue - up.baseValue) * 100),
    );
    expect(adjustmentCents(down)).toBe(
      Math.round((down.adjustedValue - down.baseValue) * 100),
    );
  });

  it("applies custom rank multipliers and treats an empty curve as neutral", () => {
    const custom = runValuationEngine(
      input({ archetype: "custom", spendingCurve: [1.2, 0.8] }),
    );
    const empty = runValuationEngine(
      input({ archetype: "custom", spendingCurve: [] }),
    );
    const customDelta = (playerId: string) =>
      custom
        .get(playerId)!
        .adjustments.find(
          (adjustment) => adjustment.label === "Custom spending curve",
        )?.delta;

    expect(customDelta("qb-1")).toBeGreaterThan(0);
    expect(customDelta("qb-2")).toBeLessThan(0);
    expect(
      [...empty.values()].some((value) =>
        value.adjustments.some(
          (adjustment) => adjustment.label === "Custom spending curve",
        ),
      ),
    ).toBe(false);
  });

  it("rejects non-finite and negative custom curve multipliers", () => {
    expect(() =>
      runValuationEngine(
        input({ archetype: "custom", spendingCurve: [Number.NaN] }),
      ),
    ).toThrow(/multiplier/i);
    expect(() =>
      runValuationEngine(input({ archetype: "custom", spendingCurve: [-0.1] })),
    ).toThrow(/multiplier/i);
  });

  it("returns zero bid guidance when the user's reserve is inconsistent", () => {
    const original = input();
    const result = runValuationEngine({
      ...original,
      teams: original.teams.map((team) =>
        team.rosterId === 1 ? { ...team, remainingBudget: 2 } : team,
      ),
    });

    expect(result.get("rb-1")!.maximumLegalBid).toBe(0);
    expect(result.get("rb-1")!.recommendedMaxBid).toBe(0);
  });

  it("returns zero legal bids for a filled roster", () => {
    const original = input();
    const result = runValuationEngine(
      input(
        {},
        {
          teams: original.teams.map((team) =>
            team.rosterId === 1
              ? { ...team, remainingBudget: 0, openSlots: 0 }
              : team,
          ),
        },
      ),
    );

    expect(result.get("rb-1")!.maximumLegalBid).toBe(0);
    expect(result.get("rb-1")!.recommendedMaxBid).toBe(0);
  });

  it("returns finite cap-constrained surplus metadata for a K-only late draft", () => {
    const league = createLeagueConfig({
      teams: 2,
      budget: 10,
      minBid: 1,
      starters: { QB: 0, RB: 0, WR: 0, TE: 0, K: 1, DEF: 0 },
      bench: 0,
      flex: [],
      receptionPoints: 0.5,
      capKickerDefenseAtOne: true,
    });
    const result = runValuationEngineWithMetadata({
      league,
      strategy: strategy({
        positionBudgets: { QB: 0, RB: 0, WR: 0, TE: 0, K: 10, DEF: 0 },
        minReserve: 1,
        valueOverrides: { "k-a": 8 },
      }),
      players: [player("k-a", "K", 20), player("k-b", "K", 10)],
      teams: [
        {
          rosterId: 1,
          name: "Me",
          remainingBudget: 5,
          openSlots: 1,
          playerIds: [],
        },
        {
          rosterId: 2,
          name: "Them",
          remainingBudget: 5,
          openSlots: 1,
          playerIds: [],
        },
      ],
      replacementLevels: {
        ...levels(),
        starterRanks: { ...levels().starterRanks, K: 2 },
        benchRanks: { ...levels().benchRanks, K: 2 },
      },
      myRosterId: 1,
      purchases: [],
    });

    expect(result.values.get("k-a")!.displayValue).toBe(1);
    expect(result.values.get("k-b")!.displayValue).toBe(1);
    expect(result.values.get("k-a")!.adjustedValue).toBe(8);
    expect(result.values.get("k-a")!.recommendedMaxBid).toBe(1);
    expect(result.metadata.budgetPace.unallocatableSurplus).toBe(8);
    expect(Number.isFinite(result.metadata.budgetPace.unallocatableSurplus)).toBe(
      true,
    );
  });

  it("rejects a missing roster and malformed or conflicting purchases", () => {
    expect(() => runValuationEngine(input({}, { myRosterId: 99 }))).toThrow(
      /roster/i,
    );
    expect(() =>
      runValuationEngine(
        input({}, { purchases: [purchase("owned-rb", 1, 0, 1)] }),
      ),
    ).toThrow(/amount/i);
    expect(() =>
      runValuationEngine(
        input({}, { purchases: [purchase("owned-rb", 2, 20, 1)] }),
      ),
    ).toThrow(/owner/i);
  });

  it("is order independent, rejects duplicates, and does not mutate input", () => {
    const original = input();
    const frozen = structuredClone(original);
    const first = runValuationEngine(original);
    const second = runValuationEngine({
      ...original,
      players: [...original.players].reverse(),
      teams: [...original.teams].reverse(),
      purchases: [...original.purchases].reverse(),
    });

    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(original).toEqual(frozen);
    expect(() =>
      runValuationEngine({
        ...original,
        purchases: [...original.purchases, original.purchases[0]],
      }),
    ).toThrow(/duplicate/i);
  });

  it("preserves every base value and display total", () => {
    const original = input({ preferences: { "rb-1": "target" } });
    const base = calculateBaseValues(original);
    const adjusted = runValuationEngine(original);

    expect(
      [...adjusted.values()].reduce(
        (sum, value) => sum + value.displayValue,
        0,
      ),
    ).toBe(
      [...base.values()].reduce((sum, value) => sum + value.displayValue, 0),
    );
    for (const [id, value] of base) {
      expect(adjusted.get(id)!.baseValue).toBe(value.baseValue);
    }
  });
});
