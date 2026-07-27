import { z } from "zod";

import { LEAGUE_LIMITS } from "@/domain/league/defaults";
import type { DraftSnapshot } from "@/domain/draft/types";
import type { DraftWarning } from "@/integrations/sleeper/normalize-draft";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const finite = z.number().finite();
const positiveSafeInteger = z.number().safe().positive();
const nonnegativeSafeInteger = z.number().safe().nonnegative();
const position = z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]);
const positionCounts = z
  .object({
    QB: nonnegativeSafeInteger,
    RB: nonnegativeSafeInteger,
    WR: nonnegativeSafeInteger,
    TE: nonnegativeSafeInteger,
    K: nonnegativeSafeInteger,
    DEF: nonnegativeSafeInteger,
  })
  .strict();

const scoring = z
  .object({
    passYard: finite,
    passTd: finite,
    interception: finite,
    rushYard: finite,
    rushTd: finite,
    reception: finite,
    receivingYard: finite,
    receivingTd: finite,
    fumbleLost: finite,
    positionReceptionBonus: z.partialRecord(position, finite),
  })
  .strict();

const league = z
  .object({
    teams: positiveSafeInteger,
    budget: positiveSafeInteger.max(LEAGUE_LIMITS.budget),
    minBid: positiveSafeInteger.max(LEAGUE_LIMITS.minBid),
    starters: positionCounts,
    bench: nonnegativeSafeInteger,
    rosterSize: positiveSafeInteger,
    flex: z.array(
      z
        .object({
          count: positiveSafeInteger,
          eligible: z.array(position).min(1),
        })
        .strict(),
    ),
    scoring,
    capKickerDefenseAtOne: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minBid > value.budget) {
      context.addIssue({
        code: "custom",
        message: "Minimum bid cannot exceed the auction budget",
        path: ["minBid"],
      });
    }
  });

const team = z
  .object({
    rosterId: positiveSafeInteger,
    name: z.string().min(1).max(256),
    remainingBudget: nonnegativeSafeInteger,
    openSlots: nonnegativeSafeInteger,
    playerIds: z.array(identifier),
    unknownCostPlayerIds: z.array(identifier).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const unknown = value.unknownCostPlayerIds ?? [];
    if (new Set(unknown).size !== unknown.length) {
      context.addIssue({
        code: "custom",
        message: "Unknown-cost player IDs must be unique",
        path: ["unknownCostPlayerIds"],
      });
    }
    const rostered = new Set(value.playerIds);
    unknown.forEach((playerId, index) => {
      if (!rostered.has(playerId)) {
        context.addIssue({
          code: "custom",
          message: "Unknown-cost ownership must be present on the roster",
          path: ["unknownCostPlayerIds", index],
        });
      }
    });
  });

const purchase = z
  .object({
    draftId: identifier,
    playerId: identifier,
    rosterId: positiveSafeInteger,
    amount: positiveSafeInteger,
    pickNo: positiveSafeInteger,
    createdAt: timestamp.nullable(),
    source: z.literal("sleeper"),
    keeper: z.boolean(),
  })
  .strict();

const snapshotSchema = z
  .object({
    draftId: identifier,
    status: z.enum(["pre", "drafting", "complete"]),
    type: z.literal("auction"),
    league,
    teams: z.array(team),
    purchases: z.array(purchase),
    lastUpdatedAt: timestamp,
  })
  .strict()
  .superRefine((snapshot, context) => {
    snapshot.purchases.forEach((item, index) => {
      if (item.amount < snapshot.league.minBid) {
        context.addIssue({
          code: "custom",
          message: "Purchase is below the league minimum bid",
          path: ["purchases", index, "amount"],
        });
      }
    });
  });

const warningSchema = z
  .object({
    code: z.enum(["SCORING_INFERRED", "SCORING_DEFAULTED"]),
    source: z.literal("draft.metadata.scoring_type"),
    message: z.string().min(1).max(256),
  })
  .strict();

export class InvalidDraftResponseError extends Error {
  constructor() {
    super("Sleeper returned an invalid draft response");
    this.name = "InvalidDraftResponseError";
  }
}

export function parseDraftSnapshot(
  value: unknown,
  requestedDraftId: string,
): DraftSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.draftId !== requestedDraftId) {
    throw new InvalidDraftResponseError();
  }
  if (parsed.data.purchases.some((item) => item.draftId !== requestedDraftId)) {
    throw new InvalidDraftResponseError();
  }
  return parsed.data;
}

export function parseDraftApiResponse(
  value: unknown,
  requestedDraftId: string,
): DraftSnapshot {
  if (!value || typeof value !== "object" || !("snapshot" in value)) {
    throw new InvalidDraftResponseError();
  }
  return parseDraftSnapshot(
    (value as Record<string, unknown>).snapshot,
    requestedDraftId,
  );
}

export function parseDraftSetupResponse(
  value: unknown,
  requestedDraftId: string,
): { snapshot: DraftSnapshot; warnings: DraftWarning[] } {
  if (!value || typeof value !== "object" || !("snapshot" in value)) {
    throw new InvalidDraftResponseError();
  }
  const record = value as Record<string, unknown>;
  const warnings = z.array(warningSchema).max(8).safeParse(record.warnings ?? []);
  if (!warnings.success) throw new InvalidDraftResponseError();
  return {
    snapshot: parseDraftSnapshot(record.snapshot, requestedDraftId),
    warnings: warnings.data,
  };
}
