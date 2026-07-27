import { describe, expect, it } from "vitest";

import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";
import { createDraftSessionStore } from "@/features/draft-session/store";

const purchase: DraftPurchase = { draftId: "draft-1", playerId: "player-1", rosterId: 1, amount: 20, pickNo: 1, createdAt: null, source: "sleeper", keeper: false };
const snapshot: DraftSnapshot = { draftId: "draft-1", status: "drafting", type: "auction", league: { minBid: 1 } as DraftSnapshot["league"], teams: [], purchases: [purchase], lastUpdatedAt: "2026-07-25T12:00:00.000Z" };

describe("draft session store", () => {
  it("keeps local corrections separate while reconciling authoritative snapshots", () => {
    const store = createDraftSessionStore({ snapshot, localCorrections: [] });
    store.getState().addLocalCorrection({ ...purchase, amount: 35, source: "local" });
    expect(store.getState().localCorrections).toHaveLength(1);
    expect(store.getState().snapshot.purchases[0].amount).toBe(20);

    store.getState().reconcile({ ...snapshot, purchases: [{ ...purchase, amount: 35 }] });
    expect(store.getState().localCorrections).toEqual([]);
    expect(store.getState().snapshot.purchases[0].amount).toBe(35);
  });
});
