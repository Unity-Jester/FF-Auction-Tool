import { describe, expect, it } from "vitest";
import type { DraftPurchase, TeamDraftState } from "@/domain/draft/types";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";
import type { StrategyConfig } from "@/domain/strategy/types";
import { calculateBaseValues } from "@/domain/valuation/base-values";
import {
  runValuationEngine,
  type PlayerValuation,
  type RunValuationEngineInput,
} from "@/domain/valuation/engine";
import type {
  ReplacementLevels,
  ScoredPlayer,
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
      QB: 30,
      RB: 80,
      WR: 60,
      TE: 20,
      K: 5,
      DEF: 5,
    },
    spendingCurve: [],
    qbApproach: "auto",
    teApproach: "auto",
    rbBuild: "auto",
    minReserve: 0,
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
  return {
    starterRanks: { ...zeroes },
    benchRanks: { ...zeroes },
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

  it("summarizes only the three largest adjustments and includes Target", () => {
    const result = runValuationEngine(
      input({
        archetype: "stars-and-scrubs",
        qbApproach: "elite",
        preferences: { "qb-1": "target" },
        positionBudgets: {
          ...strategy().positionBudgets,
          QB: 200,
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
      input({ positionBudgets: { ...strategy().positionBudgets, WR: 200 } }),
    );
    const over = runValuationEngine(
      input({ positionBudgets: { ...strategy().positionBudgets, WR: 0 } }),
    );

    expect(adjustmentPercent(under, "wr-1", "POSITION_BUDGET")).toBeGreaterThan(
      0,
    );
    expect(adjustmentPercent(over, "wr-1", "POSITION_BUDGET")).toBeLessThan(0);
  });

  it("adds roster need for an open fixed starter but not a filled position", () => {
    const result = runValuationEngine(input());

    expect(
      result.get("wr-1")!.adjustments.some((a) => a.code === "ROSTER_NEED"),
    ).toBe(true);
    expect(
      result.get("rb-1")!.adjustments.some((a) => a.code === "ROSTER_NEED"),
    ).toBe(false);
  });

  it("does not treat an open flex slot as a fixed-position roster need", () => {
    const original = input();
    const myTeam = {
      ...original.teams[0],
      remainingBudget: 50,
      openSlots: 1,
      playerIds: ["owned-rb", "qb-1", "wr-1", "te-1"],
    };
    const result = runValuationEngine({
      ...original,
      league: {
        ...original.league,
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

    for (const playerId of ["rb-1", "wr-2", "te-2"]) {
      const adjustmentCodes = result
        .get(playerId)!
        .adjustments.map((adjustment) => adjustment.code);
      expect(adjustmentCodes).not.toContain("ROSTER_NEED");
      expect(adjustmentCodes).not.toContain("POSITION_BUDGET");
    }
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

  it("uses an authoritative rostered keeper to fill a fixed starter slot", () => {
    const original = input();
    const keeper = player("keeper-te", "TE", Number.NaN);
    const result = runValuationEngine({
      ...original,
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
        positionBudgets: { ...strategy().positionBudgets, QB: 500 },
      }),
    ).get("qb-1")!;
    const down = runValuationEngine(
      input({
        archetype: "custom",
        spendingCurve: [0],
        qbApproach: "value",
        preferences: { "qb-1": "avoid" },
        positionBudgets: { ...strategy().positionBudgets, QB: 0 },
      }),
    ).get("qb-1")!;

    expect(up.adjustedValue).toBeCloseTo(up.baseValue * 1.35, 2);
    expect(down.adjustedValue).toBeCloseTo(down.baseValue * 0.65, 2);
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
