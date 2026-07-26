import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";

export type DraftSessionState = {
  snapshot: DraftSnapshot;
  localCorrections: DraftPurchase[];
};

const identity = (purchase: DraftPurchase) =>
  `${purchase.draftId}\u0000${purchase.playerId}\u0000${purchase.rosterId}`;

const timestamp = (value: string | null) => value ?? "";

function comparePurchases(a: DraftPurchase, b: DraftPurchase) {
  return (
    a.pickNo - b.pickNo ||
    timestamp(a.createdAt).localeCompare(timestamp(b.createdAt)) ||
    a.playerId.localeCompare(b.playerId)
  );
}

function validPurchase(value: DraftPurchase, source: DraftPurchase["source"]) {
  return (
    value.source === source &&
    typeof value.draftId === "string" &&
    value.draftId.length > 0 &&
    typeof value.playerId === "string" &&
    value.playerId.length > 0 &&
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
): DraftPurchase[] {
  const unique = new Map<string, DraftPurchase>();
  for (const purchase of purchases) {
    if (!validPurchase(purchase, source)) continue;
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
    local.createdAt === sleeper.createdAt &&
    local.keeper === sleeper.keeper
  );
}

/** Reconciles a Sleeper snapshot without mixing in locally corrected purchases. */
export function reconcileDraft(
  previous: DraftSessionState,
  incoming: DraftSnapshot,
): DraftSessionState {
  const purchases = canonicalPurchases(incoming.purchases, "sleeper");
  const localCorrections = canonicalPurchases(previous.localCorrections, "local").filter(
    (local) => !purchases.some((authoritative) => exactMatch(local, authoritative)),
  );
  const samePurchases = equivalentPurchases(previous.snapshot.purchases, purchases);
  const sameCorrections = equivalentPurchases(previous.localCorrections, localCorrections);
  const sameSnapshot =
    samePurchases &&
    JSON.stringify({ ...previous.snapshot, purchases: undefined }) ===
      JSON.stringify({ ...incoming, purchases: undefined });

  if (sameSnapshot && sameCorrections) return previous;

  return {
    snapshot: sameSnapshot
      ? previous.snapshot
      : { ...incoming, purchases },
    localCorrections,
  };
}
