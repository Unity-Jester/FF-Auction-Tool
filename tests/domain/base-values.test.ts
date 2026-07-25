import { describe, expect, it } from "vitest";
import type { TeamDraftState } from "@/domain/draft/types";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";
import type { StrategyConfig } from "@/domain/strategy/types";
import {
  calculateBaseValues,
  type CalculateBaseValuesInput,
} from "@/domain/valuation/base-values";
import type {
  ReplacementLevels,
  ScoredPlayer,
} from "@/domain/valuation/replacement-levels";
import { allocateLargestRemainders } from "@/domain/valuation/round-money";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

function league(options: {
  budget?: number;
  minBid?: number;
  capKickerDefenseAtOne?: boolean;
}) {
  return createLeagueConfig({
    teams: 2,
    budget: options.budget ?? 20,
    minBid: options.minBid ?? 1,
    starters: { QB: 0, RB: 1, WR: 0, TE: 0, K: 1, DEF: 0 },
    bench: 2,
    flex: [],
    receptionPoints: 0.5,
    capKickerDefenseAtOne: options.capKickerDefenseAtOne ?? true,
  });
}

function strategy(starterBudgetShare = 0.75): StrategyConfig {
  return {
    id: "test",
    name: "Test",
    archetype: "balanced",
    starterBudgetShare,
    positionBudgets: Object.fromEntries(
      positions.map((position) => [position, 0]),
    ) as Record<Position, number>,
    spendingCurve: [],
    qbApproach: "auto",
    teApproach: "auto",
    rbBuild: "auto",
    minReserve: 0,
    preferences: {},
    projectionOverrides: {},
    valueOverrides: {},
  };
}

function replacementLevels(
  starterPoints: Partial<Record<Position, number>> = {},
  benchPoints: Partial<Record<Position, number>> = {},
): ReplacementLevels {
  const record = (values: Partial<Record<Position, number>>) =>
    Object.fromEntries(
      positions.map((position) => [position, values[position] ?? 0]),
    ) as Record<Position, number>;

  return {
    starterRanks: record({}),
    benchRanks: record({}),
    starterPoints: record(starterPoints),
    benchPoints: record(benchPoints),
    replacementPlayerIds: { RB: "rb-replacement", K: "k-replacement" },
  };
}

function player(
  playerId: string,
  position: Position,
  points: number,
): ScoredPlayer {
  return { playerId, positions: [position], points };
}

function baseInput(
  overrides: Partial<CalculateBaseValuesInput> = {},
): CalculateBaseValuesInput {
  return {
    league: league({}),
    strategy: strategy(),
    players: [
      player("rb-elite", "RB", 120),
      player("rb-2", "RB", 105),
      player("rb-3", "RB", 90),
      player("rb-replacement", "RB", 70),
      player("rb-5", "RB", 60),
      player("rb-6", "RB", 50),
      player("rb-outside", "RB", 40),
      player("k-1", "K", 65),
      player("drafted", "RB", 130),
    ],
    teams: [
      {
        rosterId: 1,
        name: "One",
        remainingBudget: 14,
        openSlots: 3,
        playerIds: ["drafted"],
      },
      {
        rosterId: 2,
        name: "Two",
        remainingBudget: 20,
        openSlots: 4,
        playerIds: [],
      },
    ],
    replacementLevels: replacementLevels({ RB: 70, K: 65 }, { RB: 50, K: 65 }),
    ...overrides,
  };
}

describe("allocateLargestRemainders", () => {
  it("reaches the exact target and breaks equal remainders by ID", () => {
    expect(
      allocateLargestRemainders(
        [
          { id: "b", floor: 2, remainder: 0.5 },
          { id: "a", floor: 3, remainder: 0.5 },
          { id: "c", floor: 1, remainder: 0.1 },
        ],
        8,
      ),
    ).toEqual(
      new Map([
        ["a", 4],
        ["b", 3],
        ["c", 1],
      ]),
    );
  });

  it("rejects a target that cannot be reached by largest-remainder rounding", () => {
    expect(() =>
      allocateLargestRemainders([{ id: "a", floor: 2, remainder: 0.4 }], 4),
    ).toThrow(/impossible/i);
  });
});

describe("calculateBaseValues", () => {
  it("allocates the exact live budget over the draftable pool and caps kickers", () => {
    const values = calculateBaseValues(baseInput());
    const draftable = [...values.values()].filter(
      (value) => value.displayValue > 0,
    );

    expect(draftable).toHaveLength(7);
    expect(draftable.reduce((sum, value) => sum + value.displayValue, 0)).toBe(
      34,
    );
    expect(values.get("rb-elite")!.displayValue).toBeGreaterThan(
      values.get("rb-replacement")!.displayValue,
    );
    expect(values.get("rb-outside")!.displayValue).toBe(0);
    expect(values.get("k-1")!.displayValue).toBeLessThanOrEqual(1);
    expect(values.has("drafted")).toBe(false);
  });

  it("reports inflation when live dollars per remaining VORP increase", () => {
    const preDraft = calculateBaseValues(
      baseInput({
        teams: [
          {
            rosterId: 1,
            name: "One",
            remainingBudget: 20,
            openSlots: 4,
            playerIds: [],
          },
          {
            rosterId: 2,
            name: "Two",
            remainingBudget: 20,
            openSlots: 4,
            playerIds: [],
          },
        ],
      }),
    );
    const preDraftDisplayValues = new Map(
      [...preDraft].map(([id, value]) => [id, value.displayValue]),
    );
    const live = calculateBaseValues(
      baseInput({
        teams: [
          {
            rosterId: 1,
            name: "One",
            remainingBudget: 18,
            openSlots: 2,
            playerIds: ["drafted"],
          },
          {
            rosterId: 2,
            name: "Two",
            remainingBudget: 20,
            openSlots: 4,
            playerIds: [],
          },
        ],
        preDraftDisplayValues,
      }),
    );

    expect(live.get("rb-elite")!.inflationMultiplier).toBeGreaterThan(1);
  });

  it("excludes keeper IDs while retaining their cost in remaining budget", () => {
    const values = calculateBaseValues(
      baseInput({
        teams: [
          {
            rosterId: 1,
            name: "One",
            remainingBudget: 12,
            openSlots: 3,
            playerIds: ["rb-elite"],
          },
          {
            rosterId: 2,
            name: "Two",
            remainingBudget: 20,
            openSlots: 4,
            playerIds: [],
          },
        ],
      }),
    );

    expect(values.has("rb-elite")).toBe(false);
    expect(
      [...values.values()].reduce((sum, value) => sum + value.displayValue, 0),
    ).toBe(32);
  });

  it("throws when remaining budgets cannot reserve the minimum bid", () => {
    expect(() =>
      calculateBaseValues(
        baseInput({
          league: league({ minBid: 2 }),
          teams: [
            {
              rosterId: 1,
              name: "One",
              remainingBudget: 3,
              openSlots: 2,
              playerIds: [],
            },
          ],
        }),
      ),
    ).toThrow(/minimum.bid|reserve/i);
  });

  it("rejects a $1 K/DEF cap when the league minimum bid is higher", () => {
    expect(() =>
      calculateBaseValues(
        baseInput({
          league: league({ minBid: 2, capKickerDefenseAtOne: true }),
        }),
      ),
    ).toThrow("K/DEF $1 cap requires a $1 minimum bid");
  });

  it("supports a minimum bid above $1 when the K/DEF cap is disabled", () => {
    const values = calculateBaseValues(
      baseInput({
        league: league({ minBid: 2, capKickerDefenseAtOne: false }),
      }),
    );
    const draftable = [...values.values()].filter(
      (value) => value.displayValue > 0,
    );

    expect(draftable).toHaveLength(7);
    expect(draftable.every((value) => value.displayValue >= 2)).toBe(true);
    expect(draftable.reduce((sum, value) => sum + value.displayValue, 0)).toBe(
      34,
    );
  });

  it("preserves all dollars with a deterministic all-zero VORP fallback", () => {
    const values = calculateBaseValues(
      baseInput({
        league: league({ capKickerDefenseAtOne: false }),
        players: [
          player("rb-b", "RB", 20),
          player("rb-a", "RB", 20),
          player("rb-c", "RB", 10),
        ],
        teams: [
          {
            rosterId: 1,
            name: "One",
            remainingBudget: 10,
            openSlots: 2,
            playerIds: [],
          },
        ],
        replacementLevels: replacementLevels({ RB: 100 }, { RB: 100 }),
      }),
    );

    expect(values.get("rb-a")!.displayValue).toBe(9);
    expect(values.get("rb-b")!.displayValue).toBe(1);
    expect(values.get("rb-c")!.displayValue).toBe(0);
  });

  it("throws when every draftable player is capped and extra dollars remain", () => {
    expect(() =>
      calculateBaseValues(
        baseInput({
          players: [player("k-a", "K", 20), player("k-b", "K", 10)],
          teams: [
            {
              rosterId: 1,
              name: "One",
              remainingBudget: 5,
              openSlots: 2,
              playerIds: [],
            },
          ],
          replacementLevels: replacementLevels({ K: 0 }, { K: 0 }),
        }),
      ),
    ).toThrow(/capped|allocate/i);
  });

  it("canonicalizes duplicates, ignores drafted and malformed players, and uses the first supported position", () => {
    const values = calculateBaseValues(
      baseInput({
        players: [
          {
            playerId: "dual",
            positions: ["INVALID", "WR", "RB"] as Position[],
            points: 80,
          },
          { playerId: "dual", positions: ["RB"], points: 70 },
          { playerId: "drafted", positions: ["RB"], points: 200 },
          { playerId: "nan", positions: ["RB"], points: Number.NaN },
          {
            playerId: "unsupported",
            positions: ["INVALID"] as unknown as Position[],
            points: 100,
          },
          player("rb-fill", "RB", 10),
        ],
        teams: [
          {
            rosterId: 1,
            name: "One",
            remainingBudget: 2,
            openSlots: 2,
            playerIds: ["drafted"],
          },
        ],
        replacementLevels: replacementLevels(
          { RB: 0, WR: 0 },
          { RB: 0, WR: 0 },
        ),
      }),
    );

    expect([...values.keys()].sort()).toEqual(["dual", "rb-fill"]);
    expect(values.get("dual")).toMatchObject({ position: "WR", points: 80 });
  });

  it("rejects an insufficient player pool", () => {
    expect(() =>
      calculateBaseValues(
        baseInput({
          players: [player("only", "RB", 10)],
          teams: [
            {
              rosterId: 1,
              name: "One",
              remainingBudget: 2,
              openSlots: 2,
              playerIds: [],
            },
          ],
        }),
      ),
    ).toThrow(/player pool|players/i);
  });

  it.each([
    { remainingBudget: Number.NaN, openSlots: 1 },
    { remainingBudget: 3.5, openSlots: 1 },
    { remainingBudget: 3, openSlots: -1 },
    { remainingBudget: 3, openSlots: 1.5 },
  ])("rejects invalid team state %#", ({ remainingBudget, openSlots }) => {
    const teams: TeamDraftState[] = [
      {
        rosterId: 1,
        name: "One",
        remainingBudget,
        openSlots,
        playerIds: [],
      },
    ];
    expect(() => calculateBaseValues(baseInput({ teams }))).toThrow(
      /team|budget|slots/i,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    "rejects invalid starterBudgetShare %s",
    (starterBudgetShare) => {
      expect(() =>
        calculateBaseValues(
          baseInput({ strategy: strategy(starterBudgetShare) }),
        ),
      ).toThrow(/starterBudgetShare/i);
    },
  );

  it("does not mutate any input", () => {
    const input = baseInput({
      preDraftDisplayValues: new Map([["rb-elite", 5]]),
    });
    const before = {
      league: structuredClone(input.league),
      strategy: structuredClone(input.strategy),
      players: structuredClone(input.players),
      teams: structuredClone(input.teams),
      replacementLevels: structuredClone(input.replacementLevels),
      preDraft: [...input.preDraftDisplayValues!],
    };

    calculateBaseValues(input);

    expect(input.league).toEqual(before.league);
    expect(input.strategy).toEqual(before.strategy);
    expect(input.players).toEqual(before.players);
    expect(input.teams).toEqual(before.teams);
    expect(input.replacementLevels).toEqual(before.replacementLevels);
    expect([...input.preDraftDisplayValues!]).toEqual(before.preDraft);
  });
});
