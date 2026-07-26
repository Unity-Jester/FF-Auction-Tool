import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";

export type DraftSessionState = {
  snapshot: DraftSnapshot;
  localCorrections: DraftPurchase[];
};

const identity = (purchase: DraftPurchase) =>
  JSON.stringify([purchase.draftId, purchase.playerId, purchase.rosterId]);

const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

const timestamp = (value: string | null) =>
  value === null ? Number.POSITIVE_INFINITY : Date.parse(value);

function comparePurchases(a: DraftPurchase, b: DraftPurchase) {
  const timestampDifference = timestamp(a.createdAt) - timestamp(b.createdAt);
  return (
    a.pickNo - b.pickNo ||
    (Number.isNaN(timestampDifference) ? 0 : timestampDifference) ||
    a.playerId.localeCompare(b.playerId)
  );
}

function validPurchase(
  value: DraftPurchase,
  source: DraftPurchase["source"],
  draftId: string,
) {
  return (
    value.source === source &&
    value.draftId === draftId &&
    identifier(value.draftId) &&
    identifier(value.playerId) &&
    Number.isInteger(value.rosterId) &&
    value.rosterId > 0 &&
    Number.isFinite(value.amount) &&
    value.amount > 0 &&
    Number.isInteger(value.pickNo) &&
    value.pickNo > 0 &&
    (value.createdAt === null ||
      (typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)))) &&
    typeof value.keeper === "boolean"
  );
}

function canonicalPurchases(
  purchases: DraftPurchase[],
  source: DraftPurchase["source"],
  draftId: string,
): DraftPurchase[] {
  const unique = new Map<string, DraftPurchase>();
  for (const purchase of purchases) {
    if (!validPurchase(purchase, source, draftId)) continue;
    const key = identity(purchase);
    const prior = unique.get(key);
    // A duplicate from the same response is ignored; the first record is stable.
    if (!prior) unique.set(key, purchase);
  }
  return [...unique.values()].sort(comparePurchases);
}

function equivalentPurchases(a: DraftPurchase[], b: DraftPurchase[]) {
  return (
    a.length === b.length &&
    a.every(
      (purchase, index) =>
        JSON.stringify(purchase) === JSON.stringify(b[index]),
    )
  );
}

function exactMatch(local: DraftPurchase, sleeper: DraftPurchase) {
  return (
    identity(local) === identity(sleeper) &&
    local.amount === sleeper.amount &&
    local.pickNo === sleeper.pickNo &&
    local.keeper === sleeper.keeper
  );
}

/** Reconciles a Sleeper snapshot without mixing in locally corrected purchases. */
export function reconcileDraft(
  previous: DraftSessionState,
  incoming: DraftSnapshot,
): DraftSessionState {
  if (
    !identifier(previous.snapshot.draftId) ||
    incoming.draftId !== previous.snapshot.draftId
  ) {
    return previous;
  }
  const purchases = canonicalPurchases(
    incoming.purchases,
    "sleeper",
    incoming.draftId,
  );
  const localCorrections = canonicalPurchases(
    previous.localCorrections,
    "local",
    incoming.draftId,
  ).filter(
    (local) => !purchases.some((authoritative) => exactMatch(local, authoritative)),
  );
  const samePurchases = equivalentPurchases(previous.snapshot.purchases, purchases);
  const sameCorrections = equivalentPurchases(previous.localCorrections, localCorrections);
  const sameSnapshot =
    samePurchases &&
    JSON.stringify({
      ...previous.snapshot,
      purchases: undefined,
      lastUpdatedAt: undefined,
    }) ===
      JSON.stringify({
        ...incoming,
        purchases: undefined,
        lastUpdatedAt: undefined,
      });

  if (sameSnapshot && sameCorrections) return previous;

  return {
    snapshot: sameSnapshot
      ? previous.snapshot
      : { ...incoming, purchases },
    localCorrections,
  };
}
