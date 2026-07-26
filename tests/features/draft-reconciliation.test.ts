import { describe, expect, it } from "vitest";

import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";
import { reconcileDraft } from "@/features/draft-session/reconcile";

const purchase = (overrides: Partial<DraftPurchase> = {}): DraftPurchase => ({
  draftId: "draft-1",
  playerId: "player-1",
  rosterId: 1,
  amount: 25,
  pickNo: 1,
  createdAt: "2026-07-25T12:00:00.000Z",
  source: "sleeper",
  keeper: false,
  ...overrides,
});

const snapshot = (purchases: DraftPurchase[]): DraftSnapshot => ({
  draftId: "draft-1",
  status: "drafting",
  type: "auction",
  league: {} as DraftSnapshot["league"],
  teams: [],
  purchases,
  lastUpdatedAt: "2026-07-25T12:00:00.000Z",
});

describe("reconcileDraft", () => {
  it("preserves object identity for an identical response", () => {
    const previous = { snapshot: snapshot([purchase()]), localCorrections: [] };

    expect(reconcileDraft(previous, snapshot([purchase()]))).toBe(previous);
  });

  it("adds a delayed authoritative purchase in deterministic order", () => {
    const previous = { snapshot: snapshot([purchase({ playerId: "player-2", pickNo: 2 })]), localCorrections: [] };
    const result = reconcileDraft(
      previous,
      snapshot([purchase({ playerId: "player-2", pickNo: 2 }), purchase()]),
    );

    expect(result.snapshot.purchases.map((item) => item.playerId)).toEqual([
      "player-1",
      "player-2",
    ]);
  });

  it("replaces an authoritative purchase when Sleeper corrects it", () => {
    const previous = { snapshot: snapshot([purchase()]), localCorrections: [] };
    const result = reconcileDraft(previous, snapshot([purchase({ amount: 37 })]));

    expect(result.snapshot.purchases[0].amount).toBe(37);
  });

  it("retires an exact local correction only after an authoritative match", () => {
    const correction = purchase({ amount: 37, source: "local" });
    const previous = { snapshot: snapshot([purchase()]), localCorrections: [correction] };

    const waiting = reconcileDraft(previous, snapshot([purchase()]));
    expect(waiting.localCorrections).toEqual([correction]);

    const resolved = reconcileDraft(previous, snapshot([purchase({ amount: 37 })]));
    expect(resolved.localCorrections).toEqual([]);
  });

  it("drops malformed and duplicate purchases without allowing NaN into state", () => {
    const result = reconcileDraft(
      { snapshot: snapshot([]), localCorrections: [] },
      snapshot([
        purchase(),
        purchase(),
        purchase({ playerId: "bad", amount: Number.NaN }),
        purchase({ playerId: "missing", rosterId: 0 }),
      ]),
    );

    expect(result.snapshot.purchases).toEqual([purchase()]);
  });
});
