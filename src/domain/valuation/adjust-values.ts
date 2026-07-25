import type { Position } from "../league/types";
import type { StrategyConfig } from "../strategy/types";
import type { BasePlayerValue } from "./base-values";

export type ValueAdjustmentCode =
  | "POSITION_BUDGET"
  | "ROSTER_NEED"
  | "SCARCITY"
  | "SPENDING_CURVE"
  | "TARGET"
  | "AVOID"
  | "LOCK"
  | "MANUAL";

export type ValueAdjustment = {
  code: ValueAdjustmentCode;
  label: string;
  delta: number;
};

export type PercentAdjustment = Omit<ValueAdjustment, "delta"> & {
  percent: number;
};

export type PositionState = {
  draftedCounts: Record<Position, number>;
  spend: Record<Position, number>;
  desiredSlots: Record<Position, number>;
  leagueNeed: Record<Position, number>;
};

const PREFERENCE_EFFECTS = {
  target: { code: "TARGET", label: "Target", percent: 8 },
  avoid: { code: "AVOID", label: "Avoid", percent: -20 },
  lock: { code: "LOCK", label: "Lock", percent: 15 },
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rankPercent(index: number, length: number): number {
  return length <= 1 ? 0 : index / (length - 1);
}

function spendingCurveParts(
  player: BasePlayerValue,
  strategy: StrategyConfig,
  rankedAll: ReadonlyArray<BasePlayerValue>,
  rankedAtPosition: ReadonlyArray<BasePlayerValue>,
): PercentAdjustment[] {
  const parts: PercentAdjustment[] = [];
  const allIndex = rankedAll.findIndex(
    (candidate) => candidate.playerId === player.playerId,
  );
  const overallRank = rankPercent(allIndex, rankedAll.length);

  if (strategy.archetype === "stars-and-scrubs") {
    if (overallRank <= 0.1) {
      parts.push({
        code: "SPENDING_CURVE",
        label: "Stars and scrubs",
        percent: 10,
      });
    } else if (overallRank >= 0.5) {
      parts.push({
        code: "SPENDING_CURVE",
        label: "Stars and scrubs depth",
        percent: -6,
      });
    }
  } else if (strategy.archetype === "balanced") {
    if (overallRank <= 0.1) {
      parts.push({
        code: "SPENDING_CURVE",
        label: "Balanced depth",
        percent: -5,
      });
    } else if (overallRank >= 0.5) {
      parts.push({
        code: "SPENDING_CURVE",
        label: "Balanced depth",
        percent: 4,
      });
    }
  } else if (strategy.archetype === "custom") {
    strategy.spendingCurve.forEach((multiplier, index) => {
      if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new Error(
          `Spending curve multiplier ${index + 1} must be finite and non-negative`,
        );
      }
    });
    if (strategy.spendingCurve.length > 0) {
      const curveIndex = Math.min(allIndex, strategy.spendingCurve.length - 1);
      const multiplier = strategy.spendingCurve[curveIndex];
      parts.push({
        code: "SPENDING_CURVE",
        label: "Custom spending curve",
        percent: clamp((multiplier - 1) * 100, -15, 15),
      });
    }
  }

  const positionIndex = rankedAtPosition.findIndex(
    (candidate) => candidate.playerId === player.playerId,
  );
  const positionRank = rankPercent(positionIndex, rankedAtPosition.length);
  const approach =
    player.position === "QB"
      ? strategy.qbApproach
      : player.position === "TE"
        ? strategy.teApproach
        : "auto";
  const approachLabel = player.position === "QB" ? "QB" : "TE";
  if (approach === "elite") {
    parts.push({
      code: "SPENDING_CURVE",
      label: `Elite ${approachLabel}`,
      percent: positionRank <= 0.25 ? 8 : -3,
    });
  } else if (approach === "value") {
    parts.push({
      code: "SPENDING_CURVE",
      label: `Value ${approachLabel}`,
      percent: positionRank <= 0.25 ? -6 : 5,
    });
  }

  if (player.position === "RB" && strategy.rbBuild === "hero") {
    if (positionIndex === 0) {
      parts.push({
        code: "SPENDING_CURVE",
        label: "Hero RB",
        percent: 10,
      });
    }
  } else if (player.position === "RB" && strategy.rbBuild === "zero") {
    parts.push({
      code: "SPENDING_CURVE",
      label: "Zero RB",
      percent: positionRank <= 0.25 ? -10 : 5,
    });
  }

  const total = parts.reduce((sum, part) => sum + part.percent, 0);
  const boundedTotal = clamp(total, -15, 15);
  const scale = total === 0 ? 1 : boundedTotal / total;
  return parts
    .map((part) => ({ ...part, percent: part.percent * scale }))
    .filter((part) => part.percent !== 0);
}

function positionBudgetAdjustment(
  player: BasePlayerValue,
  strategy: StrategyConfig,
  positionState: PositionState,
  rankedAtPosition: ReadonlyArray<BasePlayerValue>,
): PercentAdjustment | undefined {
  const slots = positionState.desiredSlots[player.position];
  const goal = strategy.positionBudgets[player.position];
  if (slots <= 0 || !Number.isFinite(goal) || goal < 0) {
    return undefined;
  }
  const remainingGoal = Math.max(
    0,
    goal - positionState.spend[player.position],
  );
  const expected = rankedAtPosition
    .slice(0, slots)
    .reduce((sum, value) => sum + value.baseValue, 0);
  if (expected <= 0) {
    return undefined;
  }
  const percent = clamp((remainingGoal / expected - 1) * 15, -15, 15);
  return percent === 0
    ? undefined
    : {
        code: "POSITION_BUDGET",
        label: "Position budget",
        percent,
      };
}

function needAdjustment(
  player: BasePlayerValue,
  positionState: PositionState,
): PercentAdjustment | undefined {
  const needed = positionState.desiredSlots[player.position];
  if (needed <= 0) {
    return undefined;
  }
  return {
    code: "ROSTER_NEED",
    label: "Roster need",
    percent: clamp(needed * 6, 0, 12),
  };
}

function scarcityAdjustment(
  player: BasePlayerValue,
  positionState: PositionState,
  rankedAtPosition: ReadonlyArray<BasePlayerValue>,
): PercentAdjustment | undefined {
  if (player.baseValue <= 0) {
    return undefined;
  }
  const positiveValues = rankedAtPosition.filter(
    (value) => value.baseValue > 0,
  );
  const maximum = positiveValues[0]?.baseValue ?? 0;
  if (maximum <= 0) {
    return undefined;
  }
  const tier = (value: number): "Elite" | "High" | "Mid" | "Low" => {
    const ratio = value / maximum;
    return ratio >= 0.75
      ? "Elite"
      : ratio >= 0.5
        ? "High"
        : ratio >= 0.25
          ? "Mid"
          : "Low";
  };
  const playerTier = tier(player.baseValue);
  const supply = positiveValues.filter(
    (value) => tier(value.baseValue) === playerTier,
  ).length;
  const need = Math.max(1, positionState.leagueNeed[player.position]);
  if (supply > need) {
    return undefined;
  }
  return {
    code: "SCARCITY",
    label: `${playerTier} tier scarcity`,
    percent: clamp(((need - supply + 1) / need) * 10, 0, 10),
  };
}

function preferenceAdjustment(
  player: BasePlayerValue,
  strategy: StrategyConfig,
): PercentAdjustment | undefined {
  const preference = strategy.preferences[player.playerId] ?? "neutral";
  if (preference === "neutral") {
    return undefined;
  }
  const effect = PREFERENCE_EFFECTS[preference];
  if (effect === undefined) {
    throw new Error(`Invalid preference for player ${player.playerId}`);
  }
  return { ...effect };
}

export function calculatePercentAdjustments(
  player: BasePlayerValue,
  strategy: StrategyConfig,
  positionState: PositionState,
  rankedAll: ReadonlyArray<BasePlayerValue>,
  rankedAtPosition: ReadonlyArray<BasePlayerValue>,
): PercentAdjustment[] {
  return [
    positionBudgetAdjustment(player, strategy, positionState, rankedAtPosition),
    needAdjustment(player, positionState),
    scarcityAdjustment(player, positionState, rankedAtPosition),
    ...spendingCurveParts(player, strategy, rankedAll, rankedAtPosition),
    preferenceAdjustment(player, strategy),
  ].filter((adjustment): adjustment is PercentAdjustment =>
    Boolean(adjustment),
  );
}

export function applyPercentAdjustments(
  baseValue: number,
  adjustments: ReadonlyArray<PercentAdjustment>,
): { adjustedValue: number; adjustments: ValueAdjustment[] } {
  const total = adjustments.reduce(
    (sum, adjustment) => sum + adjustment.percent,
    0,
  );
  const boundedTotal = clamp(total, -35, 35);
  const scale = total === 0 ? 1 : boundedTotal / total;
  const adjustedValue =
    Math.round(Math.max(0, baseValue * (1 + boundedTotal / 100)) * 100) / 100;
  const dollarAdjustments = adjustments.map(({ percent, ...adjustment }) => ({
    ...adjustment,
    delta: Math.round(baseValue * ((percent * scale) / 100) * 100) / 100,
  }));
  if (dollarAdjustments.length > 0) {
    const targetCents = Math.round((adjustedValue - baseValue) * 100);
    const roundedCents = dollarAdjustments.reduce(
      (sum, adjustment) => sum + Math.round(adjustment.delta * 100),
      0,
    );
    const remainderCents = targetCents - roundedCents;
    if (remainderCents !== 0) {
      const recipient = [...dollarAdjustments].sort(
        (left, right) =>
          Math.abs(right.delta) - Math.abs(left.delta) ||
          left.code.localeCompare(right.code) ||
          left.label.localeCompare(right.label),
      )[0];
      recipient.delta =
        Math.round((recipient.delta + remainderCents / 100) * 100) / 100;
    }
  }

  return {
    adjustedValue,
    adjustments: dollarAdjustments.filter(
      (adjustment) => adjustment.delta !== 0,
    ),
  };
}
