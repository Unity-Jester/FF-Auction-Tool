import type { ValueAdjustment } from "./adjust-values";

function compareAdjustments(
  left: ValueAdjustment,
  right: ValueAdjustment,
): number {
  const preferencePriority = (adjustment: ValueAdjustment) =>
    ["TARGET", "AVOID", "LOCK", "MANUAL"].includes(adjustment.code) ? 0 : 1;
  return (
    preferencePriority(left) - preferencePriority(right) ||
    Math.abs(right.delta) - Math.abs(left.delta) ||
    left.code.localeCompare(right.code) ||
    left.label.localeCompare(right.label)
  );
}

function describe(adjustment: ValueAdjustment): string {
  const sign = adjustment.delta >= 0 ? "+" : "-";
  return `${adjustment.label} ${sign}$${Math.abs(adjustment.delta).toFixed(2)}`;
}

export function sortAdjustments(
  adjustments: ReadonlyArray<ValueAdjustment>,
): ValueAdjustment[] {
  return [...adjustments].sort(compareAdjustments);
}

export function explainAdjustments(
  adjustments: ReadonlyArray<ValueAdjustment>,
): string {
  if (adjustments.length === 0) {
    return "Tracks the league-adjusted base value.";
  }

  return `${sortAdjustments(adjustments)
    .slice(0, 3)
    .map(describe)
    .join(", ")}.`;
}
