import type { DraftPurchase } from "../draft/types";
import type { Position } from "../league/types";
import {
  calculateBaseValues,
  type BasePlayerValue,
  type CalculateBaseValuesInput,
} from "./base-values";
import {
  applyPercentAdjustments,
  calculatePercentAdjustments,
  type PositionState,
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
  recommendedMaxBid: number;
  explanation: string;
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
  const assignFixedPositions = (playerIds: ReadonlyArray<string>) => {
    const remainingNeed = { ...input.league.starters };
    const counts = positionRecord();
    const assignments = new Map<string, Position>();
    [...playerIds]
      .map((playerId) => ({
        playerId,
        eligible: eligiblePositions.get(playerId) ?? [],
      }))
      .sort(
        (left, right) =>
          left.eligible.length - right.eligible.length ||
          left.playerId.localeCompare(right.playerId),
      )
      .forEach(({ playerId, eligible }) => {
        const position = [...eligible].sort(
          (left, right) =>
            remainingNeed[right] - remainingNeed[left] ||
            POSITIONS.indexOf(left) - POSITIONS.indexOf(right),
        )[0];
        if (position === undefined) {
          return;
        }
        assignments.set(playerId, position);
        counts[position] += 1;
        remainingNeed[position] = Math.max(0, remainingNeed[position] - 1);
      });
    return { assignments, counts };
  };

  const myTeam = input.teams.find(
    (team) => team.rosterId === input.myRosterId,
  )!;
  const myFixedPositions = assignFixedPositions(myTeam.playerIds);
  const draftedCounts = myFixedPositions.counts;
  const spend = positionRecord();
  input.purchases.forEach((purchase) => {
    if (purchase.rosterId !== input.myRosterId) {
      return;
    }
    const position =
      myFixedPositions.assignments.get(purchase.playerId) ??
      selectedPositions.get(purchase.playerId)!;
    spend[position] += purchase.amount;
    if (!Number.isSafeInteger(spend[position])) {
      throw new Error(`Total ${position} spend must be a safe integer`);
    }
  });

  const desiredSlots = positionRecord();
  POSITIONS.forEach((position) => {
    desiredSlots[position] = Math.max(
      0,
      input.league.starters[position] - draftedCounts[position],
    );
  });

  const leagueNeed = positionRecord();
  input.teams.forEach((team) => {
    const counts = assignFixedPositions(team.playerIds).counts;
    POSITIONS.forEach((position) => {
      leagueNeed[position] += Math.max(
        0,
        input.league.starters[position] - counts[position],
      );
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

export function runValuationEngine(
  input: RunValuationEngineInput,
): Map<string, PlayerValuation> {
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
  const legalBid = maximumLegalBid(
    matchingRosters[0].remainingBudget,
    matchingRosters[0].openSlots,
    input.league.minBid,
  );
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
        Math.min(Math.round(adjusted.adjustedValue), legalBid),
      );
      result.set(playerId, {
        ...base,
        ...adjusted,
        maximumLegalBid: legalBid,
        recommendedMaxBid,
        explanation: explainAdjustments(adjusted.adjustments),
      });
    });

  return result;
}
