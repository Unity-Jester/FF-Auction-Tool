import { describe, expect, it } from "vitest";
import type { DraftPurchase, TeamDraftState } from "@/domain/draft/types";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";
import type { StrategyConfig } from "@/domain/strategy/types";
import { calculateBaseValues } from "@/domain/valuation/base-values";
import {
  runValuationEngine,
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
