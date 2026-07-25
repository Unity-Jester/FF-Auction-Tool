import { describe, expect, it, vi } from "vitest";

import { SleeperClient, SleeperError } from "@/integrations/sleeper/client";
import { normalizeDraft } from "@/integrations/sleeper/normalize-draft";
import { parseDraftReference } from "@/integrations/sleeper/parse-draft-reference";
import { createDraftHandler } from "@/app/api/sleeper/drafts/[draftId]/route";
import { createUserDraftsHandler } from "@/app/api/sleeper/users/[username]/drafts/route";

const auctionDraft = {
  draft_id: "123456789012345678",
  type: "auction",
  status: "drafting",
  league_id: "league-1",
  settings: {
    teams: 4,
    budget: 200,
    slots_qb: 1,
    slots_rb: 2,
    slots_wr: 2,
    slots_te: 1,
    slots_k: 1,
    slots_def: 1,
    slots_bn: 5,
    slots_flex: 1,
    slots_super_flex: 1,
  },
  metadata: {},
};

const league = {
  league_id: "league-1",
  total_rosters: 4,
  roster_positions: [
    "QB",
    "RB",
    "RB",
    "WR",
    "WR",
    "TE",
    "FLEX",
    "SUPER_FLEX",
    "K",
    "DEF",
    "BN",
    "BN",
    "BN",
    "BN",
    "BN",
  ],
  scoring_settings: {
    pass_yd: 0.04,
    pass_td: 6,
    pass_int: -1,
    rush_yd: 0.1,
    rush_td: 6,
    rec: 1,
    rec_yd: 0.1,
    rec_td: 6,
    fum_lost: -2,
    bonus_rec_te: 0.5,
  },
  settings: {},
};

describe("parseDraftReference", () => {
  it.each([
    ["123456789012345678", "123456789012345678"],
    ["https://sleeper.com/draft/nfl/123456789012345678", "123456789012345678"],
    ["https://sleeper.app/draft/nfl/123456789012345678/", "123456789012345678"],
    [
      "https://sleeper.com/draft/nfl/123456789012345678?foo=bar",
      "123456789012345678",
    ],
  ])("parses %s", (reference, expected) => {
    expect(parseDraftReference(reference)).toBe(expected);
  });

  it.each([
    "",
    "draft 123456789012345678",
    "https://example.com/draft/nfl/123456789012345678",
    "https://sleeper.com/foo/123456789012345678",
    "abc123456789012345678",
    "123",
    "123456789012345678901234567890",
  ])("rejects %s without mining embedded digits", (reference) => {
    expect(() => parseDraftReference(reference)).toThrow("Invalid Sleeper draft");
  });
});

describe("normalizeDraft", () => {
  it("normalizes auction purchases and league rules", () => {
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [
        {
          draft_id: auctionDraft.draft_id,
          player_id: "4046",
          roster_id: 3,
          pick_no: 1,
          metadata: { amount: "42", is_keeper: "true" },
        },
      ],
      league,
      users: [{ user_id: "u3", display_name: "Ada" }],
      rosters: [{ roster_id: 3, owner_id: "u3" }],
    });

    expect(result.snapshot.purchases).toEqual([
      expect.objectContaining({
        playerId: "4046",
        rosterId: 3,
        amount: 42,
        pickNo: 1,
        keeper: true,
      }),
    ]);
    expect(result.snapshot.league).toMatchObject({
      teams: 4,
      budget: 200,
      minBid: 1,
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
      bench: 5,
      scoring: {
        passTd: 6,
        interception: -1,
        reception: 1,
        positionReceptionBonus: { TE: 0.5 },
      },
    });
    expect(result.snapshot.league.flex).toEqual([
      { count: 1, eligible: ["RB", "WR", "TE"] },
      { count: 1, eligible: ["QB", "RB", "WR", "TE"] },
    ]);
    expect(result.teams[2]).toMatchObject({
      rosterId: 3,
      userId: "u3",
      name: "Ada",
    });
  });

  it("rejects snake drafts with a stable code", () => {
    expect(() =>
      normalizeDraft({ draft: { ...auctionDraft, type: "snake" }, picks: [] }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_DRAFT_TYPE" }));
  });

  it("quarantines malformed amounts instead of creating zero-dollar picks", () => {
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [
        {
          draft_id: auctionDraft.draft_id,
          player_id: "4046",
          roster_id: 3,
          pick_no: 1,
          metadata: { amount: "42 dollars" },
        },
      ],
    });

    expect(result.snapshot.purchases).toHaveLength(0);
    expect(result.quarantinedPicks).toHaveLength(1);
  });

  it("deduplicates exact picks and quarantines conflicting duplicates", () => {
    const basePick = {
      draft_id: auctionDraft.draft_id,
      player_id: "4046",
      roster_id: 3,
      pick_no: 1,
      metadata: { amount: "42" },
    };
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [
        basePick,
        { ...basePick },
        { ...basePick, metadata: { amount: "43" } },
      ],
    });

    expect(result.snapshot.purchases).toHaveLength(0);
    expect(result.quarantinedPicks).toHaveLength(3);
  });

  it("retains one copy of exact duplicate purchases", () => {
    const pick = {
      draft_id: auctionDraft.draft_id,
      player_id: "4046",
      roster_id: 3,
      pick_no: 1,
      metadata: { amount: "42", created_at: "2026-07-25T10:00:00.000Z" },
    };
    const result = normalizeDraft({ draft: auctionDraft, picks: [pick, { ...pick }] });

    expect(result.snapshot.purchases).toHaveLength(1);
    expect(result.quarantinedPicks).toHaveLength(0);
  });

  it("quarantines corrected pick-number conflicts sharing purchase identity", () => {
    const pick = {
      draft_id: auctionDraft.draft_id,
      player_id: "4046",
      roster_id: 3,
      pick_no: 1,
      metadata: { amount: "42" },
    };
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [pick, { ...pick, pick_no: 2 }],
    });

    expect(result.snapshot.purchases).toHaveLength(0);
    expect(result.quarantinedPicks).toEqual([
      expect.objectContaining({ reason: "CONFLICTING_DUPLICATE" }),
      expect.objectContaining({ reason: "CONFLICTING_DUPLICATE" }),
    ]);
  });

  it("quarantines timestamp conflicts sharing purchase identity", () => {
    const pick = {
      draft_id: auctionDraft.draft_id,
      player_id: "4046",
      roster_id: 3,
      pick_no: 1,
      metadata: { amount: "42", created_at: "2026-07-25T10:00:00.000Z" },
    };
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [
        pick,
        {
          ...pick,
          metadata: { ...pick.metadata, created_at: "2026-07-25T10:00:01.000Z" },
        },
      ],
    });

    expect(result.snapshot.purchases).toHaveLength(0);
    expect(result.quarantinedPicks).toHaveLength(2);
  });

  it("quarantines every record in a mixed exact-and-conflicting group", () => {
    const pick = {
      draft_id: auctionDraft.draft_id,
      player_id: "4046",
      roster_id: 3,
      pick_no: 1,
      metadata: { amount: "42" },
    };
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [pick, { ...pick }, { ...pick, metadata: { amount: "43" } }],
    });

    expect(result.snapshot.purchases).toHaveLength(0);
    expect(result.quarantinedPicks).toHaveLength(3);
  });

  it.each([
    ["pre_draft", "pre"],
    ["drafting", "drafting"],
    ["complete", "complete"],
  ] as const)("maps %s status to %s", (source, expected) => {
    const result = normalizeDraft({
      draft: { ...auctionDraft, status: source },
      picks: [],
    });
    expect(result.snapshot.status).toBe(expected);
  });

  it("builds stable mock teams when league_id is null", () => {
    const result = normalizeDraft({
      draft: {
        ...auctionDraft,
        league_id: null,
        slot_to_roster_id: { "1": 7, "2": 2 },
        draft_order: { Alice: 1, Bob: 2 },
        settings: { ...auctionDraft.settings, teams: 2 },
      },
      picks: [],
    });

    expect(result.snapshot.teams.map((team) => [team.rosterId, team.name])).toEqual([
      [7, "Alice"],
      [2, "Bob"],
    ]);
  });
});

describe("SleeperClient", () => {
  it("encodes path components, uses GET, and forwards cache options", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([])));
    const client = new SleeperClient(fetchFn);
    await client.getUserDrafts("a/b c", "2026", { next: { revalidate: 2 } });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/user/a%2Fb%20c/drafts/nfl/2026",
      expect.objectContaining({ method: "GET", next: { revalidate: 2 } }),
    );
  });

  it.each([
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "UPSTREAM"],
  ])("maps HTTP %s to %s without leaking response bodies", async (status, code) => {
    const fetchFn = vi.fn(
      async () => new Response("super-secret upstream body", { status }),
    );
    const client = new SleeperClient(fetchFn);

    await expect(client.getDraft("123456789012345678")).rejects.toMatchObject({
      code,
    });
    await expect(client.getDraft("123456789012345678")).rejects.not.toThrow(
      /super-secret/,
    );
  });

  it("maps invalid JSON/schema responses to MALFORMED", async () => {
    const client = new SleeperClient(
      vi.fn(async () => new Response(JSON.stringify({ nope: true }))),
    );
    await expect(client.getDraft("123456789012345678")).rejects.toMatchObject({
      code: "MALFORMED",
    });
  });
});

describe("Sleeper routes", () => {
  it("discovers only current-season auction drafts, including mocks", async () => {
    const client = {
      getUser: vi.fn(async () => ({ user_id: "u1", display_name: "Ada" })),
      getNflState: vi.fn(async () => ({ season: "2026" })),
      getUserDrafts: vi.fn(async () => [
        auctionDraft,
        { ...auctionDraft, draft_id: "222222222222222222", league_id: null },
        { ...auctionDraft, draft_id: "333333333333333333", type: "snake" },
      ]),
    };
    const GET = createUserDraftsHandler(client);
    const response = await GET(
      new Request("http://localhost/api/sleeper/users/Ada/drafts"),
      { params: Promise.resolve({ username: " Ada " }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      season: "2026",
      drafts: [
        { draftId: auctionDraft.draft_id, leagueId: "league-1" },
        { draftId: "222222222222222222", leagueId: null },
      ],
    });
    expect(client.getUserDrafts).toHaveBeenCalledWith(
      "u1",
      "2026",
      expect.objectContaining({ next: { revalidate: 2 } }),
    );
  });

  it("normalizes real and mock draft detail without requiring global fetch", async () => {
    const createClient = (
      draft: Omit<typeof auctionDraft, "league_id"> & {
        league_id: string | null;
        slot_to_roster_id?: Record<string, number>;
        draft_order?: Record<string, number>;
      },
    ) => ({
      getDraft: vi.fn(async () => draft),
      getDraftPicks: vi.fn(async () => []),
      getLeague: vi.fn(async () => league),
      getLeagueUsers: vi.fn(async () => []),
      getLeagueRosters: vi.fn(async () => []),
      getPlayers: vi.fn(async () => ({})),
    });

    const realClient = createClient(auctionDraft);
    const realResponse = await createDraftHandler(realClient)(
      new Request(`http://localhost/api/sleeper/drafts/${auctionDraft.draft_id}`),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );
    expect(realResponse.status).toBe(200);
    expect(realClient.getLeague).toHaveBeenCalledWith(
      "league-1",
      expect.objectContaining({ next: { revalidate: 300 } }),
    );

    const mockClient = createClient({
      ...auctionDraft,
      league_id: null,
      settings: { ...auctionDraft.settings, teams: 2 },
      slot_to_roster_id: { "1": 7, "2": 2 },
      draft_order: { Alice: 1, Bob: 2 },
    });
    const mockResponse = await createDraftHandler(mockClient)(
      new Request(`http://localhost/api/sleeper/drafts/${auctionDraft.draft_id}`),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );
    expect(mockResponse.status).toBe(200);
    expect(mockClient.getLeague).not.toHaveBeenCalled();
    expect(mockClient.getPlayers).toHaveBeenCalledWith(
      expect.objectContaining({ next: { revalidate: 86_400 } }),
    );
    expect(mockClient.getDraftPicks).toHaveBeenCalledWith(
      auctionDraft.draft_id,
      expect.objectContaining({ next: { revalidate: 2 } }),
    );
    expect((await mockResponse.json()).snapshot.teams).toEqual([
      expect.objectContaining({ rosterId: 7, name: "Alice" }),
      expect.objectContaining({ rosterId: 2, name: "Bob" }),
    ]);
  });

  it("carries schema-invalid picks through the client and quarantines only that pick", async () => {
    const mockDraft = {
      ...auctionDraft,
      league_id: null,
      settings: { ...auctionDraft.settings, teams: 2 },
      slot_to_roster_id: { "1": 7, "2": 2 },
      draft_order: { Alice: 1, Bob: 2 },
    };
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith(`/draft/${auctionDraft.draft_id}`)) {
        return new Response(JSON.stringify(mockDraft));
      }
      if (url.endsWith(`/draft/${auctionDraft.draft_id}/picks`)) {
        return new Response(
          JSON.stringify([
            {
              draft_id: auctionDraft.draft_id,
              player_id: "4046",
              roster_id: 7,
              pick_no: 1,
              metadata: { amount: "42" },
            },
            {
              draft_id: auctionDraft.draft_id,
              player_id: "bad",
              roster_id: 0,
              pick_no: 2,
              metadata: { amount: "12" },
            },
          ]),
        );
      }
      if (url.endsWith("/players/nfl")) return new Response(JSON.stringify({}));
      return new Response("unexpected", { status: 500 });
    });
    const response = await createDraftHandler(new SleeperClient(fetchFn))(
      new Request(`http://localhost/api/sleeper/drafts/${auctionDraft.draft_id}`),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot.purchases).toEqual([
      expect.objectContaining({ playerId: "4046", rosterId: 7, amount: 42 }),
    ]);
    expect(body.quarantinedPicks).toEqual([
      expect.objectContaining({ reason: "INVALID_PICK" }),
    ]);
    expect(body.snapshot.teams).toEqual([
      expect.objectContaining({ rosterId: 7, name: "Alice" }),
      expect.objectContaining({ rosterId: 2, name: "Bob" }),
    ]);
  });

  it("rejects invalid draft detail references before calling Sleeper", async () => {
    const client = {
      getDraft: vi.fn(),
      getDraftPicks: vi.fn(),
      getLeague: vi.fn(),
      getLeagueUsers: vi.fn(),
      getLeagueRosters: vi.fn(),
      getPlayers: vi.fn(),
    };
    const response = await createDraftHandler(client)(
      new Request("http://localhost"),
      { params: Promise.resolve({ draftId: "draft-123456789012345678" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_DRAFT", message: "Invalid Sleeper draft" },
    });
    expect(client.getDraft).not.toHaveBeenCalled();
  });

  it("returns stable JSON errors", async () => {
    const client = {
      getUser: vi.fn(async () => {
        throw new SleeperError("NOT_FOUND");
      }),
      getNflState: vi.fn(),
      getUserDrafts: vi.fn(),
    };
    const response = await createUserDraftsHandler(client)(
      new Request("http://localhost"),
      { params: Promise.resolve({ username: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Sleeper resource not found" },
    });
  });

  it.each([
    ["RATE_LIMITED", 429, "Sleeper rate limit reached"],
    ["UPSTREAM", 502, "Sleeper service unavailable"],
    ["MALFORMED", 502, "Sleeper returned malformed data"],
  ] as const)("returns stable draft-route %s errors", async (code, status, message) => {
    const client = {
      getDraft: vi.fn(async () => {
        throw new SleeperError(code);
      }),
      getDraftPicks: vi.fn(async () => []),
      getLeague: vi.fn(),
      getLeagueUsers: vi.fn(),
      getLeagueRosters: vi.fn(),
      getPlayers: vi.fn(async () => ({})),
    };
    const response = await createDraftHandler(client)(
      new Request("http://localhost"),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(status);
    expect(JSON.parse(serialized)).toEqual({ error: { code, message } });
    expect(serialized).not.toContain("raw upstream secret");
  });
});
