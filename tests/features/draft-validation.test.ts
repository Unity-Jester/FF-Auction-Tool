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
  it("accepts explicit unknown-cost ownership when it is a unique subset of the roster", () => {
    const withKeeper = {
      ...snapshot,
      teams: snapshot.teams.map((team, index) =>
        index === 0
          ? {
              ...team,
              playerIds: ["roster-held-keeper"],
              unknownCostPlayerIds: ["roster-held-keeper"],
            }
          : team,
      ),
    };

    expect(parseDraftSnapshot(withKeeper, "draft-1").teams[0]).toMatchObject({
      unknownCostPlayerIds: ["roster-held-keeper"],
    });
  });

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

  it.each([
    ["decimal league budget", { ...snapshot, league: { ...snapshot.league, budget: 200.5 } }],
    ["unsafe minimum bid", { ...snapshot, league: { ...snapshot.league, minBid: Number.MAX_SAFE_INTEGER + 1 } }],
    ["decimal remaining budget", { ...snapshot, teams: [{ ...snapshot.teams[0], remainingBudget: 199.5 }] }],
    ["unsafe roster ID", { ...snapshot, teams: [{ ...snapshot.teams[0], rosterId: Number.MAX_SAFE_INTEGER + 1 }] }],
    ["decimal purchase amount", { ...snapshot, purchases: [{ draftId: "draft-1", playerId: "player-1", rosterId: 1, amount: 1.5, pickNo: 1, createdAt: null, source: "sleeper", keeper: false }] }],
    ["purchase below minimum bid", { ...snapshot, league: { ...snapshot.league, minBid: 2 }, purchases: [{ draftId: "draft-1", playerId: "player-1", rosterId: 1, amount: 1, pickNo: 1, createdAt: null, source: "sleeper", keeper: false }] }],
    ["unsafe pick number", { ...snapshot, purchases: [{ draftId: "draft-1", playerId: "player-1", rosterId: 1, amount: 20, pickNo: Number.MAX_SAFE_INTEGER + 1, createdAt: null, source: "sleeper", keeper: false }] }],
  ])("rejects non-integer monetary or numeric domain data: %s", (_name, malformed) => {
    expect(() => parseDraftSnapshot(malformed, "draft-1")).toThrow(
      "invalid draft response",
    );
  });
});
