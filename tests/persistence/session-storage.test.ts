import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StrategyConfig } from "@/domain/strategy/types";
import {
  clearSession,
  loadSession,
  saveSession,
  SESSION_LIMITS,
  sessionStorageKey,
} from "@/persistence/session-storage";

const strategy: StrategyConfig = {
  id: "balanced",
  name: "Balanced",
  archetype: "balanced",
  starterBudgetShare: 0.7,
  positionBudgets: { QB: 20, RB: 60, WR: 60, TE: 20, K: 1, DEF: 1 },
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

const session = (overrides: Record<string, unknown> = {}) => ({
  version: 1 as const,
  draftId: "draft-1",
  strategy,
  preferences: {},
  localCorrections: [],
  csvProjectionOverrides: [],
  savedAt: "2026-07-25T12:00:00.000Z",
  ...overrides,
});

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

  it("enforces strategy ranges and exact supported position budget keys", () => {
    saveSession(session({ strategy: { ...strategy, starterBudgetShare: 1.1 } }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    saveSession(session({ strategy: { ...strategy, minReserve: -1 } }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    saveSession(session({
      strategy: {
        ...strategy,
        positionBudgets: { ...strategy.positionBudgets, IDP: 0.2 },
      },
    }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();
  });

  it("rejects local corrections from another draft on save and load", () => {
    const foreignCorrection = {
      draftId: "draft-2",
      playerId: "player-1",
      rosterId: 1,
      amount: 20,
      pickNo: 1,
      createdAt: null,
      source: "local",
      keeper: false,
    };
    saveSession(session({ localCorrections: [foreignCorrection] }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    localStorage.setItem(
      sessionStorageKey("draft-1"),
      JSON.stringify(session({ localCorrections: [foreignCorrection] })),
    );
    expect(loadSession("draft-1")).toBeNull();
  });

  it("rejects decimal and unsafe monetary and draft numeric fields", () => {
    saveSession(session({ strategy: { ...strategy, minReserve: 1.5 } }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    saveSession(session({ strategy: { ...strategy, positionBudgets: { ...strategy.positionBudgets, QB: 20.5 } } }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    const correction = {
      draftId: "draft-1",
      playerId: "player-1",
      rosterId: 1,
      amount: 20,
      pickNo: 1,
      createdAt: null,
      source: "local",
      keeper: false,
    };
    for (const invalid of [
      { ...correction, amount: 20.5 },
      { ...correction, amount: Number.MAX_SAFE_INTEGER + 1 },
      { ...correction, rosterId: Number.MAX_SAFE_INTEGER + 1 },
      { ...correction, pickNo: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      saveSession(session({ localCorrections: [invalid] }));
      expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();
    }
  });

  it("bounds collection counts, record keys, string lengths, and stored JSON bytes", () => {
    saveSession(session({
      preferences: Object.fromEntries(
        Array.from({ length: SESSION_LIMITS.maxPreferences + 1 }, (_, index) => [
          `player-${index}`,
          "target",
        ]),
      ),
    }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    saveSession(session({ preferences: { ["x".repeat(SESSION_LIMITS.maxStringLength + 1)]: "target" } }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    const correction = {
      draftId: "draft-1",
      playerId: "player-1",
      rosterId: 1,
      amount: 20,
      pickNo: 1,
      createdAt: null,
      source: "local",
      keeper: false,
    };
    saveSession(session({
      localCorrections: Array.from(
        { length: SESSION_LIMITS.maxCorrections + 1 },
        (_, index) => ({ ...correction, playerId: `player-${index}` }),
      ),
    }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    const projection = {
      playerId: "player-1",
      name: "Player One",
      team: "CHI",
      positions: ["RB"],
      stats: { rushYards: 1_000 },
      source: "csv",
      updatedAt: "2026-07-25T12:00:00.000Z",
    };
    saveSession(session({
      csvProjectionOverrides: Array.from(
        { length: SESSION_LIMITS.maxCsvProjections + 1 },
        (_, index) => ({ ...projection, playerId: `player-${index}` }),
      ),
    }));
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();

    localStorage.setItem(
      sessionStorageKey("draft-1"),
      " ".repeat(SESSION_LIMITS.maxBytes + 1),
    );
    expect(loadSession("draft-1")).toBeNull();
  });

  it("does not throw when browser storage is unavailable or full and clears only its exact key", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(saveSession({ version: 1, draftId: "draft-1", strategy, preferences: {}, localCorrections: [], csvProjectionOverrides: [], savedAt: "2026-07-25T12:00:00.000Z" })).toEqual({ ok: false, reason: "STORAGE" });
    setItem.mockRestore();
    localStorage.setItem(sessionStorageKey("draft-1"), "one");
    localStorage.setItem(sessionStorageKey("draft-2"), "two");
    clearSession("draft-1");
    expect(localStorage.getItem(sessionStorageKey("draft-1"))).toBeNull();
    expect(localStorage.getItem(sessionStorageKey("draft-2"))).toBe("two");
  });
});
