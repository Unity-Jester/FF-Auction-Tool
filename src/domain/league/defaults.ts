import type { FlexSlot, LeagueConfig, Position, ScoringRules } from "./types";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const defaultScoring: Omit<ScoringRules, "reception" | "positionReceptionBonus"> = {
  passYard: 0.04,
  passTd: 4,
  interception: -2,
  rushYard: 0.1,
  rushTd: 6,
  receivingYard: 0.1,
  receivingTd: 6,
  fumbleLost: -2,
};

const supportedScoringFields = [
  "passYard",
  "passTd",
  "interception",
  "rushYard",
  "rushTd",
  "receivingYard",
  "receivingTd",
  "fumbleLost",
] as const;

export type CreateLeagueConfigInput = {
  teams: number;
  budget: number;
  minBid?: number;
  starters: Record<Position, number>;
  bench: number;
  flex: ReadonlyArray<{ count: number; eligible: ReadonlyArray<Position> }>;
  receptionPoints: number;
  scoring?: Partial<Omit<ScoringRules, "reception" | "positionReceptionBonus">> & {
    positionReceptionBonus?: Partial<Record<Position, number>>;
  };
  capKickerDefenseAtOne?: boolean;
};

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function normalizeFlex(flex: CreateLeagueConfigInput["flex"]): FlexSlot[] {
  return flex.map((slot, index) => {
    assertNonNegativeInteger(slot.count, `Flex slot ${index + 1} count`);

    if (slot.eligible.length === 0) {
      throw new Error(`Flex slot ${index + 1} must have at least one eligible position`);
    }

    const eligible = [...slot.eligible];
    if (eligible.some((position) => !positions.includes(position))) {
      throw new Error(`Flex slot ${index + 1} contains an unsupported position`);
    }
    if (new Set(eligible).size !== eligible.length) {
      throw new Error(`Flex slot ${index + 1} contains duplicate eligible positions`);
    }

    return { count: slot.count, eligible };
  });
}

function normalizeScoring(
  receptionPoints: number,
  overrides: CreateLeagueConfigInput["scoring"],
): ScoringRules {
  assertFiniteNumber(receptionPoints, "Reception points");

  const scoring = { ...defaultScoring };
  supportedScoringFields.forEach((field) => {
    const value = overrides?.[field];
    if (value !== undefined) {
      assertFiniteNumber(value, `Scoring ${field}`);
      scoring[field] = value;
    }
  });

  const positionReceptionBonus: Partial<Record<Position, number>> = {};
  positions.forEach((position) => {
    const value = overrides?.positionReceptionBonus?.[position];
    if (value !== undefined) {
      assertFiniteNumber(value, `Position reception bonus for ${position}`);
      positionReceptionBonus[position] = value;
    }
  });

  return { ...scoring, reception: receptionPoints, positionReceptionBonus };
}

export function createLeagueConfig(input: CreateLeagueConfigInput): LeagueConfig {
  assertPositiveInteger(input.teams, "Teams");
  assertPositiveInteger(input.budget, "Budget");

  const minBid = input.minBid ?? 1;
  assertPositiveInteger(minBid, "Minimum bid");
  assertNonNegativeInteger(input.bench, "Bench");
  positions.forEach((position) =>
    assertNonNegativeInteger(input.starters[position], `${position} starters`),
  );

  const flex = normalizeFlex(input.flex);
  const starters = { ...input.starters };
  const rosterSize =
    positions.reduce((total, position) => total + starters[position], 0) +
    flex.reduce((total, slot) => total + slot.count, 0) +
    input.bench;

  if (input.budget < rosterSize * minBid) {
    throw new Error("Budget must cover every roster slot");
  }

  return {
    teams: input.teams,
    budget: input.budget,
    minBid,
    starters,
    bench: input.bench,
    rosterSize,
    flex,
    scoring: normalizeScoring(input.receptionPoints, input.scoring),
    capKickerDefenseAtOne: input.capKickerDefenseAtOne ?? true,
  };
}
