import { z } from "zod";

import type { DraftSnapshot } from "@/domain/draft/types";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const finite = z.number().finite();
const position = z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]);
const positionCounts = z
  .object({
    QB: z.number().int().nonnegative(),
    RB: z.number().int().nonnegative(),
    WR: z.number().int().nonnegative(),
    TE: z.number().int().nonnegative(),
    K: z.number().int().nonnegative(),
    DEF: z.number().int().nonnegative(),
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
    teams: z.number().int().positive(),
    budget: finite.positive(),
    minBid: finite.positive(),
    starters: positionCounts,
    bench: z.number().int().nonnegative(),
    rosterSize: z.number().int().positive(),
    flex: z.array(
      z
        .object({
          count: z.number().int().positive(),
          eligible: z.array(position).min(1),
        })
        .strict(),
    ),
    scoring,
    capKickerDefenseAtOne: z.boolean(),
  })
  .strict();

const team = z
  .object({
    rosterId: z.number().int().positive(),
    name: z.string().min(1).max(256),
    remainingBudget: finite.nonnegative(),
    openSlots: z.number().int().nonnegative(),
    playerIds: z.array(identifier),
  })
  .strict();

const purchase = z
  .object({
    draftId: identifier,
    playerId: identifier,
    rosterId: z.number().int().positive(),
    amount: finite.positive(),
    pickNo: z.number().int().positive(),
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
