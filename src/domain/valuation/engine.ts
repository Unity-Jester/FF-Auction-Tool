import type { DraftPurchase } from "../draft/types";
import type { Position } from "../league/types";
import {
  calculateBaseValues,
  type BasePlayerValue,
  type CalculateBaseValuesInput,
} from "./base-values";
import {
  applyPercentAdjustments,
  calculatePositionScarcity,
  calculatePercentAdjustments,
  type PositionState,
  type ValueTier,
  type ValueAdjustment,
} from "./adjust-values";
import { explainAdjustments, sortAdjustments } from "./explanations";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
export type { ValueAdjustment } from "./adjust-values";

export type RunValuationEngineInput = CalculateBaseValuesInput & {
  myRosterId: number;
  purchases: DraftPurchase[];
};

export type PlayerValuation = BasePlayerValue & {
  adjustments: ValueAdjustment[];
  adjustedValue: number;
  maximumLegalBid: number;
  strategyMaximumBid: number;
  recommendedMaxBid: number;
  explanation: string;
};

export type ValuationMetadata = {
  needs: {
    mine: Record<Position, number>;
    league: Record<Position, number>;
  };
  bestFitPositionsByPlayerId: Readonly<Record<string, Position[]>>;
  tiersByPosition: Readonly<
    Record<
      Position,
      ReadonlyArray<{
        tier: ValueTier;
        supply: number;
        highestValue: number;
        lowestValue: number;
      }>
    >
  >;
  blueprintProgress: {
    filledByPosition: Record<Position, number>;
    openByPosition: Record<Position, number>;
    spendByPosition: Record<Position, number>;
    budgetByPosition: Record<Position, number>;
  };
  budgetPace: {
    remainingBudget: number;
    hardLegalMaximum: number;
    strategyMaximum: number;
    configuredExtraReserve: number;
  };
};

function positionRecord(initial = 0): Record<Position, number> {
  return Object.fromEntries(
    POSITIONS.map((position) => [position, initial]),
  ) as Record<Position, number>;
}

function compareValues(left: BasePlayerValue, right: BasePlayerValue): number {
  return (
    right.baseValue - left.baseValue ||
    right.points - left.points ||
    left.playerId.localeCompare(right.playerId)
  );
}

function roundTwoDecimals(value: number): number {
  return Number(value.toFixed(2));
}

type CanonicalPlayerContext = {
  selectedPositions: Map<string, Position>;
  eligiblePositions: Map<string, Position[]>;
};

function canonicalPlayerContext(
  input: RunValuationEngineInput,
): CanonicalPlayerContext {
  const canonical = new Map<
    string,
    { positions: Set<Position>; points?: number }
  >();
  input.players.forEach((player) => {
    if (
      typeof player.playerId !== "string" ||
      !Array.isArray(player.positions)
    ) {
      return;
    }
    const current = canonical.get(player.playerId) ?? {
      positions: new Set<Position>(),
    };
    player.positions.forEach((position) => {
      if (POSITIONS.includes(position)) {
        current.positions.add(position);
      }
    });
    if (
      Number.isFinite(player.points) &&
      (current.points === undefined || player.points > current.points)
    ) {
      current.points = player.points;
    }
    canonical.set(player.playerId, current);
  });
  const selectedPositions = new Map<string, Position>();
  const eligiblePositions = new Map<string, Position[]>();
  [...canonical.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([playerId, player]) => {
      const eligible = [...player.positions].sort(
        (left, right) => POSITIONS.indexOf(left) - POSITIONS.indexOf(right),
      );
      eligiblePositions.set(playerId, eligible);
      const points = player.points;
      const position =
        points === undefined
          ? eligible[0]
          : [...eligible].sort((left, right) => {
              const blended = (candidate: Position) => {
                const starter = Math.max(
                  0,
                  points - input.replacementLevels.starterPoints[candidate],
                );
                const bench = Math.max(
                  0,
                  points - input.replacementLevels.benchPoints[candidate],
                );
                const maximum = Math.max(starter, bench);
                return maximum === 0
                  ? 0
                  : maximum *
                      ((starter / maximum) * input.strategy.starterBudgetShare +
                        (bench / maximum) *
                          (1 - input.strategy.starterBudgetShare));
              };
              return (
                blended(right) - blended(left) ||
                POSITIONS.indexOf(left) - POSITIONS.indexOf(right)
              );
            })[0];
      if (position !== undefined) {
        selectedPositions.set(playerId, position);
      }
    });
  return { selectedPositions, eligiblePositions };
}

function validatePurchases(
  input: RunValuationEngineInput,
  positionsByPlayer: ReadonlyMap<string, Position>,
): void {
  const owners = new Map<string, number>();
  const rosterIds = new Set(input.teams.map((team) => team.rosterId));
  input.teams.forEach((team) =>
    team.playerIds.forEach((playerId) => owners.set(playerId, team.rosterId)),
  );
  const purchased = new Set<string>();
  const picks = new Set<number>();

  input.purchases.forEach((purchase, index) => {
    if (purchased.has(purchase.playerId)) {
      throw new Error(`Duplicate purchase for player ${purchase.playerId}`);
    }
    purchased.add(purchase.playerId);
    if (!Number.isSafeInteger(purchase.pickNo) || purchase.pickNo < 1) {
      throw new Error(`Purchase ${index + 1} pick number must be valid`);
    }
    if (picks.has(purchase.pickNo)) {
      throw new Error(`Duplicate purchase pick number ${purchase.pickNo}`);
    }
    picks.add(purchase.pickNo);
    if (
      !Number.isSafeInteger(purchase.amount) ||
      purchase.amount < input.league.minBid
    ) {
      throw new Error(`Purchase ${index + 1} amount must be a valid bid`);
    }
    if (!rosterIds.has(purchase.rosterId)) {
      throw new Error(`Purchase ${index + 1} has an unknown roster owner`);
    }
    if (owners.get(purchase.playerId) !== purchase.rosterId) {
      throw new Error(`Purchase ${index + 1} conflicts with its roster owner`);
    }
    if (!positionsByPlayer.has(purchase.playerId)) {
      throw new Error(`Purchase ${index + 1} has an unknown player`);
    }
  });
}

function buildPositionState(
  input: RunValuationEngineInput,
  selectedPositions: ReadonlyMap<string, Position>,
  eligiblePositions: ReadonlyMap<string, ReadonlyArray<Position>>,
): PositionState {
  const assignRoster = (playerIds: ReadonlyArray<string>) => {
    const counts = positionRecord();
    const assignments = new Map<string, Position>();
    const slots = [
      ...POSITIONS.flatMap((position) =>
        Array.from({ length: input.league.starters[position] }, () => ({
          eligible: [position] as Position[],
          fixed: position,
        })),
      ),
      ...[...input.league.flex]
        .sort(
          (left, right) =>
            left.eligible.length - right.eligible.length ||
            left.eligible.join("|").localeCompare(right.eligible.join("|")),
        )
        .flatMap((slot) =>
          Array.from({ length: slot.count }, () => ({
            eligible: POSITIONS.filter((position) =>
              slot.eligible.includes(position),
            ),
            fixed: undefined,
          })),
        ),
    ];
    const players = [...playerIds]
      .map((playerId) => ({
        playerId,
        eligible: eligiblePositions.get(playerId) ?? [],
      }))
      .sort(
        (left, right) =>
          left.playerId.localeCompare(right.playerId) ||
          left.eligible.length - right.eligible.length,
      );
    const eligibleSlots = new Map(
      players.map((player) => [
        player.playerId,
        slots.flatMap((slot, slotIndex) =>
          slot.eligible.some((position) => player.eligible.includes(position))
            ? [slotIndex]
            : [],
        ),
      ]),
    );
    const slotOwners = new Map<number, string>();

    const match = (playerId: string, visitedSlots: Set<number>): boolean => {
      for (const slotIndex of eligibleSlots.get(playerId) ?? []) {
        if (visitedSlots.has(slotIndex)) {
          continue;
        }
        visitedSlots.add(slotIndex);
        const currentOwner = slotOwners.get(slotIndex);
        if (currentOwner === undefined || match(currentOwner, visitedSlots)) {
          slotOwners.set(slotIndex, playerId);
          return true;
        }
      }
      return false;
    };

    players.forEach((player) => match(player.playerId, new Set<number>()));
    [...slotOwners.entries()]
      .sort(([left], [right]) => left - right)
      .forEach(([slotIndex, playerId]) => {
        const slot = slots[slotIndex];
        const selected = selectedPositions.get(playerId);
        const position =
          slot.fixed ??
          (selected !== undefined && slot.eligible.includes(selected)
            ? selected
            : undefined) ??
          slot.eligible.find((candidate) =>
            (eligiblePositions.get(playerId) ?? []).includes(candidate),
          )!;
        assignments.set(playerId, position);
        counts[position] += 1;
      });
    const unmatched = players.filter(
      (player) => !assignments.has(player.playerId),
    ).length;
    const openSlots = slots.filter(
      (_, slotIndex) => !slotOwners.has(slotIndex),
    );
    const remainingBench = Math.max(
      0,
      input.league.bench - Math.min(input.league.bench, unmatched),
    );
    const needs = positionRecord();
    openSlots.forEach((slot) => {
      slot.eligible.forEach((position) => {
        needs[position] += 1;
      });
    });
    if (remainingBench > 0) {
      POSITIONS.forEach((position) => {
        needs[position] += remainingBench;
      });
    }
    return { assignments, counts, needs };
  };

  const myTeam = input.teams.find(
    (team) => team.rosterId === input.myRosterId,
  )!;
  const myPositions = assignRoster(myTeam.playerIds);
  const draftedCounts = myPositions.counts;
  const spend = positionRecord();
  input.purchases.forEach((purchase) => {
    if (purchase.rosterId !== input.myRosterId) {
      return;
    }
    const position =
      myPositions.assignments.get(purchase.playerId) ??
      selectedPositions.get(purchase.playerId)!;
    spend[position] += purchase.amount;
    if (!Number.isSafeInteger(spend[position])) {
      throw new Error(`Total ${position} spend must be a safe integer`);
    }
  });

  const desiredSlots = myPositions.needs;

  const leagueNeed = positionRecord();
  input.teams.forEach((team) => {
    const needs = assignRoster(team.playerIds).needs;
    POSITIONS.forEach((position) => {
      leagueNeed[position] += needs[position];
    });
  });

  return {
    draftedCounts,
    spend,
    desiredSlots,
    leagueNeed,
  };
}

function maximumLegalBid(
  remainingBudget: number,
  openSlots: number,
  minBid: number,
): number {
  if (openSlots === 0) {
    return 0;
  }
  const result =
    BigInt(remainingBudget) -
    BigInt(Math.max(0, openSlots - 1)) * BigInt(minBid);
  if (result <= 0n) {
    return 0;
  }
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Maximum legal bid must be a safe integer");
  }
  return Number(result);
}

function validateOverrides(input: RunValuationEngineInput): void {
  const rawPositionBudgets: unknown = input.strategy.positionBudgets;
  if (
    rawPositionBudgets === null ||
    typeof rawPositionBudgets !== "object" ||
    Array.isArray(rawPositionBudgets)
  ) {
    throw new Error("Position budgets must be an object");
  }
  const budgetKeys = Object.keys(rawPositionBudgets);
  if (
    budgetKeys.length !== POSITIONS.length ||
    !POSITIONS.every((position) => budgetKeys.includes(position)) ||
    budgetKeys.some((position) => !POSITIONS.includes(position as Position))
  ) {
    throw new Error("Position budgets must contain exactly the supported positions");
  }
  let totalPositionBudget = 0n;
  POSITIONS.forEach((position) => {
    const budget = input.strategy.positionBudgets[position];
    if (!Number.isSafeInteger(budget) || budget < 0) {
      throw new Error(
        `Position budget for ${position} must be a non-negative safe integer`,
      );
    }
    totalPositionBudget += BigInt(budget);
  });
  if (totalPositionBudget !== BigInt(input.league.budget)) {
    throw new Error("Position budgets must conserve the league auction budget");
  }
  const mandatoryReserveBigInt =
    BigInt(input.league.rosterSize) * BigInt(input.league.minBid);
  if (mandatoryReserveBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Mandatory roster reserve must be a safe integer");
  }
  const mandatoryReserve = Number(mandatoryReserveBigInt);
  if (
    !Number.isSafeInteger(input.strategy.minReserve) ||
    input.strategy.minReserve < mandatoryReserve ||
    input.strategy.minReserve > input.league.budget
  ) {
    throw new Error(
      `Strategy reserve must be a safe integer from ${mandatoryReserve} to ${input.league.budget}`,
    );
  }
  Object.entries(input.strategy.valueOverrides).forEach(
    ([playerId, override]) => {
      if (!Number.isFinite(override) || override < 0) {
        throw new Error(
          `Value override for player ${playerId} must be finite and non-negative`,
        );
      }
    },
  );
  if (!Array.isArray(input.strategy.spendingCurve)) {
    throw new Error("Spending curve must be an array");
  }
  input.strategy.spendingCurve.forEach((multiplier, index) => {
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new Error(
        `Spending curve multiplier ${index + 1} must be finite and non-negative`,
      );
    }
  });
  Object.entries(input.strategy.preferences).forEach(
    ([playerId, preference]) => {
      if (!["target", "avoid", "lock", "neutral"].includes(preference)) {
        throw new Error(`Invalid preference for player ${playerId}`);
      }
    },
  );
}

export function runValuationEngineWithMetadata(
  input: RunValuationEngineInput,
): { values: Map<string, PlayerValuation>; metadata: ValuationMetadata } {
  const matchingRosters = input.teams.filter(
    (team) => team.rosterId === input.myRosterId,
  );
  if (matchingRosters.length !== 1) {
    throw new Error("Exactly one matching user roster is required");
  }
  validateOverrides(input);
  const playerContext = canonicalPlayerContext(input);
  validatePurchases(input, playerContext.selectedPositions);

  const baseValues = calculateBaseValues(input);
  const positionState = buildPositionState(
    input,
    playerContext.selectedPositions,
    playerContext.eligiblePositions,
  );
  const rankedAll = [...baseValues.values()].sort(compareValues);
  const byPosition = new Map(
    POSITIONS.map((position) => [
      position,
      rankedAll.filter((value) => value.position === position),
    ]),
  );
  const scarcityByPosition = new Map(
    POSITIONS.map((position) => [
      position,
      calculatePositionScarcity(byPosition.get(position)!),
    ]),
  );
  const legalBid = maximumLegalBid(
    matchingRosters[0].remainingBudget,
    matchingRosters[0].openSlots,
    input.league.minBid,
  );
  const configuredExtraReserve =
    input.strategy.minReserve -
    input.league.rosterSize * input.league.minBid;
  const strategyBid = Math.max(0, legalBid - configuredExtraReserve);
  const result = new Map<string, PlayerValuation>();

  [...baseValues.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([playerId, base]) => {
      const percentAdjustments = calculatePercentAdjustments(
        base,
        input.strategy,
        positionState,
        rankedAll,
        byPosition.get(base.position)!,
        scarcityByPosition.get(base.position)!,
      );
      const adjusted = applyPercentAdjustments(
        base.baseValue,
        percentAdjustments,
      );
      const override = input.strategy.valueOverrides[playerId];
      if (override !== undefined) {
        const roundedOverride = roundTwoDecimals(override);
        adjusted.adjustments.push({
          code: "MANUAL",
          label: "Manual override",
          delta: roundTwoDecimals(roundedOverride - adjusted.adjustedValue),
        });
        adjusted.adjustedValue = roundedOverride;
      }
      adjusted.adjustments = sortAdjustments(adjusted.adjustments);
      const recommendedMaxBid = Math.max(
        0,
        Math.min(Math.round(adjusted.adjustedValue), strategyBid),
      );
      result.set(playerId, {
        ...base,
        ...adjusted,
        maximumLegalBid: legalBid,
        strategyMaximumBid: strategyBid,
        recommendedMaxBid,
        explanation: explainAdjustments(adjusted.adjustments),
      });
    });

  const bestFitPositionsByPlayerId = Object.fromEntries(
    [...playerContext.eligiblePositions.entries()].map(
      ([playerId, eligible]) => [
        playerId,
        eligible.filter((position) => positionState.desiredSlots[position] > 0),
      ],
    ),
  );
  const tiersByPosition = Object.fromEntries(
    POSITIONS.map((position) => [
      position,
      scarcityByPosition.get(position)!.groups,
    ]),
  ) as ValuationMetadata["tiersByPosition"];
  return {
    values: result,
    metadata: {
      needs: {
        mine: { ...positionState.desiredSlots },
        league: { ...positionState.leagueNeed },
      },
      bestFitPositionsByPlayerId,
      tiersByPosition,
      blueprintProgress: {
        filledByPosition: { ...positionState.draftedCounts },
        openByPosition: { ...positionState.desiredSlots },
        spendByPosition: { ...positionState.spend },
        budgetByPosition: { ...input.strategy.positionBudgets },
      },
      budgetPace: {
        remainingBudget: matchingRosters[0].remainingBudget,
        hardLegalMaximum: legalBid,
        strategyMaximum: strategyBid,
        configuredExtraReserve,
      },
    },
  };
}

export function runValuationEngine(
  input: RunValuationEngineInput,
): Map<string, PlayerValuation> {
  return runValuationEngineWithMetadata(input).values;
}
