import { z } from "zod";

import type { StrategyConfig } from "@/domain/strategy/types";

export const MAX_STRATEGY_BYTES = 32_768;
export const MAX_STRATEGY_NAME_LENGTH = 80;

const finiteNonnegative = z.number().finite().nonnegative();
const boundedAmount = finiteNonnegative.max(100_000);
const positionBudgets = z.object({
  QB: boundedAmount,
  RB: boundedAmount,
  WR: boundedAmount,
  TE: boundedAmount,
  K: boundedAmount,
  DEF: boundedAmount,
}).strict();

export const strategyConfigSchema: z.ZodType<StrategyConfig> = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(MAX_STRATEGY_NAME_LENGTH),
  archetype: z.enum(["recommended", "balanced", "stars-and-scrubs", "custom"]),
  starterBudgetShare: z.number().finite().min(0).max(1),
  positionBudgets,
  spendingCurve: z.array(z.number().finite().min(0).max(3)).min(1).max(40),
  qbApproach: z.enum(["auto", "elite", "value"]),
  teApproach: z.enum(["auto", "elite", "value"]),
  rbBuild: z.enum(["auto", "hero", "zero"]),
  minReserve: boundedAmount,
  preferences: z.record(
    z.string().min(1).max(200),
    z.enum(["target", "avoid", "lock", "neutral"]),
  ),
  projectionOverrides: z.record(z.string().min(1).max(200), boundedAmount),
  valueOverrides: z.record(z.string().min(1).max(200), boundedAmount),
}).strict();

const savedStrategyShape = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(MAX_STRATEGY_NAME_LENGTH),
  strategy: strategyConfigSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export type SavedStrategy = z.infer<typeof savedStrategyShape>;

export interface SavedStrategyRepository {
  list(): Promise<SavedStrategy[]>;
  save(strategy: SavedStrategy): Promise<void>;
  remove(id: string): Promise<void>;
  getWarnings?(): string[];
}

export function estimatedPostgresJsonBytes(value: unknown): number {
  const compact = JSON.stringify(value);
  let separators = 0;
  let quoted = false;
  let escaped = false;
  for (const character of compact) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
    } else if (character === ":" || character === ",") {
      separators += 1;
    }
  }
  // jsonb::text adds spaces after structural separators. The fixed margin covers
  // numeric normalization differences between JavaScript and PostgreSQL.
  return new TextEncoder().encode(compact).byteLength + separators + 256;
}

export function parseSavedStrategy(value: unknown): SavedStrategy {
  const parsed = savedStrategyShape.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "name")) {
      throw new Error("Strategy name must be between 1 and 80 characters.");
    }
    throw new Error("The saved strategy is not valid.");
  }
  const bytes = estimatedPostgresJsonBytes(parsed.data.strategy);
  if (bytes > MAX_STRATEGY_BYTES) {
    throw new Error("A saved strategy cannot exceed 32 KB.");
  }
  return parsed.data;
}
