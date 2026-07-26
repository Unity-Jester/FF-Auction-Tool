import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StrategyConfig } from "@/domain/strategy/types";
import {
  clearSession,
  loadSession,
  saveSession,
  sessionStorageKey,
} from "@/persistence/session-storage";

const strategy: StrategyConfig = {
  id: "balanced",
  name: "Balanced",
  archetype: "balanced",
  starterBudgetShare: 0.7,
  positionBudgets: { QB: 0.1, RB: 0.3, WR: 0.3, TE: 0.1, K: 0.1, DEF: 0.1 },
  spendingCurve: [0.4, 0.6],
  qbApproach: "auto",
  teApproach: "auto",
  rbBuild: "auto",
  minReserve: 1,
  preferences: {},
  projectionOverrides: {},
  valueOverrides: {},
};

beforeEach(() => localStorage.clear());

describe("session storage", () => {
  it("round-trips only a valid version 1 session for its draft", () => {
    saveSession({
      version: 1,
      draftId: "draft-1",
      strategy,
      preferences: { player: "target" },
      localCorrections: [],
      csvProjectionOverrides: [],
      savedAt: "2026-07-25T12:00:00.000Z",
    });

    expect(loadSession("draft-1")?.strategy).toEqual(strategy);
    expect(loadSession("draft-2")).toBeNull();
  });

  it("migrates an explicit version 0 strategy without carrying unknown fields", () => {
    localStorage.setItem(
      sessionStorageKey("draft-1"),
      JSON.stringify({ version: 0, draftId: "draft-1", strategy, savedAt: "2026-07-25T12:00:00.000Z", admin: true }),
    );

    expect(loadSession("draft-1")).toMatchObject({
      version: 1,
      draftId: "draft-1",
      strategy,
      preferences: {},
      localCorrections: [],
      csvProjectionOverrides: [],
    });
  });

  it("discards malformed JSON, future versions, and polluted nested objects safely", () => {
    localStorage.setItem(sessionStorageKey("draft-1"), "{");
    expect(loadSession("draft-1")).toBeNull();
    localStorage.setItem(sessionStorageKey("draft-1"), JSON.stringify({ version: 2 }));
    expect(loadSession("draft-1")).toBeNull();
    localStorage.setItem(sessionStorageKey("draft-1"), JSON.stringify({ version: 1, draftId: "draft-1", strategy: { ...strategy, preferences: { "__proto__": "target" } }, preferences: {}, localCorrections: [], csvProjectionOverrides: [], savedAt: "not a date" }));
    expect(loadSession("draft-1")).toBeNull();
  });

  it("rejects version 1 records with fields outside the supported session shape", () => {
    localStorage.setItem(
      sessionStorageKey("draft-1"),
      JSON.stringify({
        version: 1,
        draftId: "draft-1",
        strategy,
        preferences: {},
        localCorrections: [],
        csvProjectionOverrides: [],
        savedAt: "2026-07-25T12:00:00.000Z",
        purchases: [],
      }),
    );

    expect(loadSession("draft-1")).toBeNull();
  });

  it("does not throw when browser storage is unavailable or full and clears only its exact key", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => saveSession({ version: 1, draftId: "draft-1", strategy, preferences: {}, localCorrections: [], csvProjectionOverrides: [], savedAt: "2026-07-25T12:00:00.000Z" })).not.toThrow();
    setItem.mockRestore();
    localStorage.setItem(sessionStorageKey("draft-1"), "one");
    localStorage.setItem(sessionStorageKey("draft-2"), "two");
    clearSession("draft-1");
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();
    expect(localStorage.getItem(sessionStorageKey("draft-2"))).toBe("two");
  });
});
