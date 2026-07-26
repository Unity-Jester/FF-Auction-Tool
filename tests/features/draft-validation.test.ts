import { describe, expect, it } from "vitest";

import { createLeagueConfig } from "@/domain/league/defaults";
import {
  parseDraftApiResponse,
  parseDraftSnapshot,
} from "@/features/draft-session/validate";

const snapshot = {
  draftId: "draft-1",
  status: "drafting",
  type: "auction",
  league: createLeagueConfig({
    teams: 2,
    budget: 200,
    starters: { QB: 1, RB: 1, WR: 1, TE: 1, K: 0, DEF: 0 },
    bench: 1,
    flex: [],
    receptionPoints: 0.5,
  }),
  teams: [
    { rosterId: 1, name: "One", remainingBudget: 200, openSlots: 5, playerIds: [] },
    { rosterId: 2, name: "Two", remainingBudget: 200, openSlots: 5, playerIds: [] },
  ],
  purchases: [],
  lastUpdatedAt: "2026-07-25T12:00:00.000Z",
};

describe("draft response validation", () => {
  it("accepts a complete normalized API response for the requested draft", () => {
    expect(parseDraftApiResponse({ snapshot }, "draft-1")).toEqual(snapshot);
    expect(parseDraftSnapshot(snapshot, "draft-1")).toEqual(snapshot);
  });

  it.each([
    ["wrong draft", { ...snapshot, draftId: "draft-2" }],
    ["status", { ...snapshot, status: "unknown" }],
    ["timestamp", { ...snapshot, lastUpdatedAt: "yesterday" }],
    ["league", { ...snapshot, league: { ...snapshot.league, teams: Number.NaN } }],
    ["team", { ...snapshot, teams: [{ rosterId: 0 }] }],
    ["purchase", { ...snapshot, purchases: [{ draftId: "draft-1" }] }],
  ])("rejects malformed %s fields", (_name, malformed) => {
    expect(() => parseDraftSnapshot(malformed, "draft-1")).toThrow(
      "invalid draft response",
    );
  });

  it("rejects API envelopes without a validated snapshot", () => {
    expect(() => parseDraftApiResponse({ snapshot: null }, "draft-1")).toThrow(
      "invalid draft response",
    );
  });
});
