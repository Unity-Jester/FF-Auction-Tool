import { describe, expect, it, vi } from "vitest";

import { SleeperClient, SleeperError } from "@/integrations/sleeper/client";
import { normalizeDraft } from "@/integrations/sleeper/normalize-draft";
import { parseDraftReference } from "@/integrations/sleeper/parse-draft-reference";
import {
  createInMemoryRateLimitStore,
  createRateLimiter,
  createRateLimitStoreFromEnv,
  createUpstashRateLimitStore,
  requestClientKey,
  type RateLimitStore,
} from "@/integrations/sleeper/rate-limiter";
import { createDraftHandler } from "@/app/api/sleeper/drafts/[draftId]/route";
import { createPlayersHandler } from "@/app/api/sleeper/players/route";
import { createUserDraftsHandler } from "@/app/api/sleeper/users/[username]/drafts/route";
import {
  SleeperDraftSchema,
  SleeperRosterSchema,
  SleeperUserSchema,
} from "@/integrations/sleeper/schemas";
import keeperRosterFixture from "../fixtures/sleeper/keeper-roster-without-pick.json";

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
    expect(() => parseDraftReference(reference)).toThrow(
      "Invalid Sleeper draft",
    );
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
          draft_slot: 3,
          pick_no: 1,
          is_keeper: true,
          metadata: { amount: "42" },
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
    expect(result).not.toHaveProperty("users");
  });

  it("preserves reliable roster-held ownership missing from the pick stream without inventing a price", () => {
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: keeperRosterFixture.picks,
      league,
      rosters: keeperRosterFixture.rosters,
    });

    expect(result.snapshot.teams[0]).toMatchObject({
      playerIds: ["picked-player", "roster-held-keeper"],
      unknownCostPlayerIds: ["roster-held-keeper"],
      remainingBudget: 158,
      openSlots: result.snapshot.league.rosterSize - 2,
    });
    expect(result.snapshot.purchases).toHaveLength(1);
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
          draft_slot: 3,
          pick_no: 1,
          metadata: { amount: "42 dollars" },
        },
      ],
    });

    expect(result.snapshot.purchases).toHaveLength(0);
    expect(result.quarantinedPicks).toHaveLength(1);
  });

  it("quarantines decimal and unsafe auction amounts", () => {
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [
        {
          draft_id: auctionDraft.draft_id,
          player_id: "4046",
          roster_id: 3,
          draft_slot: 3,
          pick_no: 1,
          metadata: { amount: "42.5" },
        },
        {
          draft_id: auctionDraft.draft_id,
          player_id: "4047",
          roster_id: 4,
          draft_slot: 4,
          pick_no: 2,
          metadata: { amount: String(Number.MAX_SAFE_INTEGER + 1) },
        },
      ],
    });

    expect(result.snapshot.purchases).toEqual([]);
    expect(result.quarantinedPicks.map(({ reason }) => reason)).toEqual([
      "INVALID_AMOUNT",
      "INVALID_AMOUNT",
    ]);
  });

  it("deduplicates exact picks and quarantines conflicting duplicates", () => {
    const basePick = {
      draft_id: auctionDraft.draft_id,
      player_id: "4046",
      roster_id: 3,
      draft_slot: 3,
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
      draft_slot: 3,
      pick_no: 1,
      metadata: { amount: "42", created_at: "2026-07-25T10:00:00.000Z" },
    };
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [pick, { ...pick }],
    });

    expect(result.snapshot.purchases).toHaveLength(1);
    expect(result.quarantinedPicks).toHaveLength(0);
  });

  it("quarantines corrected pick-number conflicts sharing purchase identity", () => {
    const pick = {
      draft_id: auctionDraft.draft_id,
      player_id: "4046",
      roster_id: 3,
      draft_slot: 3,
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
      draft_slot: 3,
      pick_no: 1,
      metadata: { amount: "42", created_at: "2026-07-25T10:00:00.000Z" },
    };
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [
        pick,
        {
          ...pick,
          metadata: {
            ...pick.metadata,
            created_at: "2026-07-25T10:00:01.000Z",
          },
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
      draft_slot: 3,
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
        draft_order: { "user-a": 1, "user-b": 2 },
        settings: { ...auctionDraft.settings, teams: 2 },
      },
      picks: [],
    });

    expect(
      result.snapshot.teams.map((team) => [team.rosterId, team.name]),
    ).toEqual([
      [7, "Team 1"],
      [2, "Team 2"],
    ]);
    expect(result.teams.map((team) => team.userId)).toEqual([
      "user-a",
      "user-b",
    ]);
  });

  it("normalizes an anonymized recorded mock-auction shape with null roster IDs", () => {
    const result = normalizeDraft({
      draft: {
        draft_id: "1212208329762275328",
        league_id: null,
        type: "auction",
        status: "paused",
        draft_order: { "user-a": 1, "user-b": 2 },
        slot_to_roster_id: { "1": 7, "2": 2 },
        settings: {
          teams: 2,
          budget: 200,
          rounds: 16,
          slots_qb: 1,
          slots_rb: 2,
          slots_wr: 3,
          slots_te: 1,
          slots_flex: 2,
          slots_super_flex: 1,
        },
        metadata: {},
      },
      picks: [
        {
          draft_id: "1212208329762275328",
          player_id: "player-a",
          roster_id: null,
          draft_slot: 1,
          pick_no: 1,
          is_keeper: true,
          metadata: { amount: "31", position: "RB" },
        },
        {
          draft_id: "1212208329762275328",
          player_id: "player-b",
          roster_id: null,
          draft_slot: 2,
          pick_no: 2,
          is_keeper: null,
          metadata: { amount: "48", position: "QB" },
        },
      ],
    });

    expect(result.snapshot.status).toBe("drafting");
    expect(result.snapshot.league.bench).toBe(6);
    expect(result.snapshot.purchases).toEqual([
      expect.objectContaining({
        playerId: "player-a",
        rosterId: 7,
        amount: 31,
        keeper: true,
      }),
      expect.objectContaining({
        playerId: "player-b",
        rosterId: 2,
        amount: 48,
        keeper: false,
      }),
    ]);
    expect(result.snapshot.teams).toEqual([
      expect.objectContaining({
        rosterId: 7,
        name: "Team 1",
        remainingBudget: 169,
      }),
      expect.objectContaining({
        rosterId: 2,
        name: "Team 2",
        remainingBudget: 152,
      }),
    ]);
  });

  it("quarantines a null-roster purchase only when its draft slot cannot be resolved", () => {
    const result = normalizeDraft({
      draft: {
        ...auctionDraft,
        league_id: null,
        settings: { ...auctionDraft.settings, teams: 2 },
        slot_to_roster_id: { "1": 7 },
        draft_order: null,
      },
      picks: [
        {
          draft_id: auctionDraft.draft_id,
          player_id: "4046",
          roster_id: null,
          draft_slot: 2,
          pick_no: 1,
          metadata: { amount: "42" },
        },
        {
          draft_id: auctionDraft.draft_id,
          player_id: "4047",
          roster_id: null,
          draft_slot: 3,
          pick_no: 2,
          metadata: { amount: "12" },
        },
      ],
    });

    expect(result.snapshot.purchases).toEqual([
      expect.objectContaining({ playerId: "4046", rosterId: 2 }),
    ]);
    expect(result.quarantinedPicks).toEqual([
      expect.objectContaining({ reason: "UNRESOLVED_ROSTER" }),
    ]);
  });

  it("maps position reception bonuses for RB, WR, and TE", () => {
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [],
      league: {
        ...league,
        scoring_settings: {
          ...league.scoring_settings,
          bonus_rec_rb: 0.1,
          bonus_rec_wr: 0.25,
          bonus_rec_te: 0.75,
        },
      },
    });

    expect(result.snapshot.league.scoring.positionReceptionBonus).toEqual({
      RB: 0.1,
      WR: 0.25,
      TE: 0.75,
    });
  });

  it.each([
    ["standard", 0, "SCORING_INFERRED"],
    ["non_ppr", 0, "SCORING_INFERRED"],
    ["half_ppr", 0.5, "SCORING_INFERRED"],
    ["ppr", 1, "SCORING_INFERRED"],
    ["dynasty_2qb", 0, "SCORING_DEFAULTED"],
    ["2qb", 0, "SCORING_DEFAULTED"],
  ] as const)(
    "maps mock scoring type %s to %s receptions with a source note",
    (scoringType, reception, warningCode) => {
      const result = normalizeDraft({
        draft: {
          ...auctionDraft,
          league_id: null,
          metadata: { scoring_type: scoringType },
        },
        picks: [],
      });

      expect(result.snapshot.league.scoring.reception).toBe(reception);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: warningCode,
          source: "draft.metadata.scoring_type",
        }),
      );
    },
  );

  it("never exposes raw or oversized fields in quarantined picks", () => {
    const result = normalizeDraft({
      draft: auctionDraft,
      picks: [
        {
          draft_id: auctionDraft.draft_id,
          player_id: "4046",
          roster_id: 3,
          draft_slot: 3,
          pick_no: 1,
          metadata: {
            amount: "not-money",
            secret: "do-not-return",
            oversized: "x".repeat(20_000),
          },
        },
      ],
    });
    const serialized = JSON.stringify(result.quarantinedPicks);

    expect(result.quarantinedPicks).toEqual([
      {
        reason: "INVALID_AMOUNT",
        index: 0,
        draftId: auctionDraft.draft_id,
        playerId: "4046",
        rosterId: 3,
        pickNo: 1,
      },
    ]);
    expect(serialized).not.toContain("do-not-return");
    expect(serialized.length).toBeLessThan(500);
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

  it("preserves active-pick cache options on repeated identical reads", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([])));
    const client = new SleeperClient(fetchFn);
    const cache = { next: { revalidate: 2 } } as const;

    await client.getDraftPicks(auctionDraft.draft_id, cache);
    await client.getDraftPicks(auctionDraft.draft_id, cache);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      `https://api.sleeper.app/v1/draft/${auctionDraft.draft_id}/picks`,
      expect.objectContaining({ method: "GET", next: { revalidate: 2 } }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      `https://api.sleeper.app/v1/draft/${auctionDraft.draft_id}/picks`,
      expect.objectContaining({ method: "GET", next: { revalidate: 2 } }),
    );
  });

  it.each([
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "UPSTREAM"],
  ])(
    "maps HTTP %s to %s without leaking response bodies",
    async (status, code) => {
      const fetchFn = vi.fn(
        async () => new Response("super-secret upstream body", { status }),
      );
      const client = new SleeperClient(fetchFn);

      await expect(client.getDraft("123456789012345678")).rejects.toMatchObject(
        {
          code,
        },
      );
      await expect(client.getDraft("123456789012345678")).rejects.not.toThrow(
        /super-secret/,
      );
    },
  );

  it("maps invalid JSON/schema responses to MALFORMED", async () => {
    const client = new SleeperClient(
      vi.fn(async () => new Response(JSON.stringify({ nope: true }))),
    );
    await expect(client.getDraft("123456789012345678")).rejects.toMatchObject({
      code: "MALFORMED",
    });
  });

  it("maps a successful null user lookup to NOT_FOUND", async () => {
    const client = new SleeperClient(vi.fn(async () => new Response("null")));
    await expect(client.getUser("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("bounds upstream rate-limit retry signals", async () => {
    const client = new SleeperClient(
      vi.fn(
        async () =>
          new Response("secret", {
            status: 429,
            headers: { "Retry-After": "9999" },
          }),
      ),
    );
    await expect(client.getDraft(auctionDraft.draft_id)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 300,
    });
  });
});

describe("Sleeper rate limiter", () => {
  it("uses a bounded deterministic window and prunes expired entries", async () => {
    let now = 0;
    const store = createInMemoryRateLimitStore({
      maxEntries: 2,
      now: () => now,
    });
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 1_000,
      store,
      now: () => now,
    });

    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect(await limiter.check("a")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect((await limiter.check("b")).allowed).toBe(true);
    expect(limiter.size).toBe(2);
    expect((await limiter.check("c")).allowed).toBe(true);
    expect(limiter.size).toBe(2);
    now = 1_001;
    expect((await limiter.check("d")).allowed).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it("shares counters and upstream circuit state across limiter instances", async () => {
    let now = 10_000;
    const store = createInMemoryRateLimitStore({ now: () => now });
    const first = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      store,
      now: () => now,
    });
    const second = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      store,
      now: () => now,
    });

    expect((await first.check("client")).allowed).toBe(true);
    expect(await second.check("client")).toMatchObject({ allowed: false });
    await first.blockFor(17);
    expect(await second.check("different-client")).toEqual({
      allowed: false,
      retryAfterSeconds: 17,
    });
    now += 17_001;
    expect((await second.check("different-client")).allowed).toBe(true);
  });

  it("uses an atomic Upstash-compatible REST increment with expiry", async () => {
    let count = 0;
    let blockedUntil: string | null = null;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body));
      if (command[0] === "GET") {
        return new Response(JSON.stringify({ result: blockedUntil }));
      }
      if (
        command[0] === "EVAL" &&
        String(command[1]).includes("blocked=tonumber")
      ) {
        if (blockedUntil) {
          return new Response(
            JSON.stringify({
              result: [Number(blockedUntil), 0, Number(blockedUntil)],
            }),
          );
        }
        count += 1;
        return new Response(
          JSON.stringify({ result: [0, count, 60_000] }),
        );
      }
      if (command[0] === "EVAL" && String(command[1]).includes("INCR")) {
        count += 1;
        return new Response(JSON.stringify({ result: [count, 60_000] }));
      }
      if (command[0] === "EVAL") {
        blockedUntil = command[4];
        return new Response(JSON.stringify({ result: Number(blockedUntil) }));
      }
      return new Response(JSON.stringify({ result: 0 }));
    });
    const store = createUpstashRateLimitStore({
      url: "https://example.upstash.io",
      token: "test-token",
      fetchFn,
    });
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      store,
      now: () => 0,
    });

    expect((await limiter.check("client")).allowed).toBe(true);
    expect(await limiter.check("client")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    await limiter.blockFor(15);
    const otherInstance = createRateLimiter({
      store,
      now: () => 0,
    });
    expect(await otherInstance.check("different-client")).toEqual({
      allowed: false,
      retryAfterSeconds: 15,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.upstash.io",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("selects exactly one explicitly trusted client IP source", () => {
    const mixedHeaders = {
      "cf-connecting-ip": "203.0.113.4",
      "x-vercel-forwarded-for": "2001:db8::1, 10.0.0.1",
      "x-forwarded-for": "198.51.100.99",
    };
    const vercel = requestClientKey(
      new Request("http://localhost", { headers: mixedHeaders }),
      {
        environment: { VERCEL: "1", TRUST_CLOUDFLARE: "true" },
        keySecret: "test-secret",
      },
    );
    const cloudflare = requestClientKey(
      new Request("http://localhost", { headers: mixedHeaders }),
      {
        environment: { TRUST_CLOUDFLARE: "true" },
        keySecret: "test-secret",
      },
    );
    const proxy = requestClientKey(
      new Request("http://localhost", { headers: mixedHeaders }),
      {
        environment: { TRUST_PROXY: "true" },
        keySecret: "test-secret",
      },
    );
    expect(vercel).toMatch(/^client:[a-f0-9]{64}$/);
    expect(cloudflare).toMatch(/^client:[a-f0-9]{64}$/);
    expect(proxy).toMatch(/^client:[a-f0-9]{64}$/);
    expect(new Set([vercel, cloudflare, proxy]).size).toBe(3);
    expect(
      requestClientKey(
        new Request("http://localhost", { headers: mixedHeaders }),
        { environment: {} },
      ),
    ).toBe("global");
  });

  it("does not fall through to spoofed headers when the selected source is absent", () => {
    expect(
      requestClientKey(
        new Request("http://localhost", {
          headers: {
            "cf-connecting-ip": "203.0.113.4",
            "x-forwarded-for": "198.51.100.99",
          },
        }),
        { environment: { VERCEL: "1", TRUST_CLOUDFLARE: "true" } },
      ),
    ).toBe("global");
    expect(
      requestClientKey(
        new Request("http://localhost", {
          headers: {
            "x-vercel-forwarded-for": "2001:db8::1",
            "x-forwarded-for": "198.51.100.99<script>",
          },
        }),
        { environment: { TRUST_PROXY: "true" } },
      ),
    ).toBe("global");
  });

  it("fails loudly for partial Upstash environment configuration", () => {
    expect(() =>
      createRateLimitStoreFromEnv({
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      }),
    ).toThrow("Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
    expect(() =>
      createRateLimitStoreFromEnv({
        UPSTASH_REDIS_REST_TOKEN: "token-only",
      }),
    ).toThrow("Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
  });
});

describe("Sleeper routes", () => {
  it("accepts live Sleeper resources whose optional metadata is null", () => {
    expect(
      SleeperUserSchema.safeParse({
        user_id: "user-1",
        display_name: "Ada",
        metadata: null,
      }).success,
    ).toBe(true);
    expect(
      SleeperDraftSchema.safeParse({
        ...auctionDraft,
        metadata: null,
      }).success,
    ).toBe(true);
    expect(
      SleeperRosterSchema.safeParse({
        roster_id: 1,
        owner_id: "user-1",
        metadata: null,
      }).success,
    ).toBe(true);
  });

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
    expect(await response.json()).toEqual({
      drafts: [
        {
          draftId: auctionDraft.draft_id,
          leagueId: "league-1",
          name: `Auction ${auctionDraft.draft_id}`,
          status: "drafting",
          type: "auction",
        },
        {
          draftId: "222222222222222222",
          leagueId: null,
          name: "Auction 222222222222222222",
          status: "drafting",
          type: "auction",
        },
      ],
    });
    expect(client.getUserDrafts).toHaveBeenCalledWith(
      "u1",
      "2026",
      expect.objectContaining({ next: { revalidate: 2 } }),
    );
  });

  it("keeps valid auctions through the real client when discovery entries are mixed", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/user/Ada")) {
        return new Response(
          JSON.stringify({ user_id: "u1", display_name: "Ada" }),
        );
      }
      if (url.endsWith("/state/nfl")) {
        return new Response(JSON.stringify({ season: "2026" }));
      }
      if (url.endsWith("/user/u1/drafts/nfl/2026")) {
        return new Response(
          JSON.stringify([
            { ...auctionDraft, draft_order: null },
            {
              ...auctionDraft,
              draft_id: "333333333333333333",
              type: "snake",
              draft_order: null,
            },
            {
              type: "auction",
              status: "drafting",
              settings: {},
              secret: "do-not-return",
              oversized: "x".repeat(20_000),
            },
          ]),
        );
      }
      return new Response("secret", { status: 500 });
    });
    const response = await createUserDraftsHandler(new SleeperClient(fetchFn))(
      new Request("http://localhost", {
        headers: { "x-real-ip": "198.51.100.1" },
      }),
      { params: Promise.resolve({ username: "Ada" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.drafts).toEqual([
      {
        draftId: auctionDraft.draft_id,
        leagueId: "league-1",
        name: `Auction ${auctionDraft.draft_id}`,
        status: "drafting",
        type: "auction",
      },
    ]);
    expect(Object.keys(body)).toEqual(["drafts"]);
    expect(JSON.stringify(body)).not.toContain("do-not-return");
    expect(JSON.stringify(body)).not.toContain("\"settings\"");
    expect(JSON.stringify(body)).not.toContain("\"metadata\"");
  });

  it("returns 404 when Sleeper answers an unknown username with null", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/user/missing")) return new Response("null");
      if (url.endsWith("/state/nfl")) {
        return new Response(JSON.stringify({ season: "2026" }));
      }
      return new Response("secret", { status: 500 });
    });
    const response = await createUserDraftsHandler(new SleeperClient(fetchFn))(
      new Request("http://localhost", {
        headers: { "x-real-ip": "198.51.100.2" },
      }),
      { params: Promise.resolve({ username: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Sleeper resource not found" },
    });
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
      getPlayers: vi.fn(async () => ({
        huge: { full_name: "Do not serialize", blob: "x".repeat(1_100_000) },
      })),
    });

    const realClient = createClient(auctionDraft);
    const realResponse = await createDraftHandler(realClient)(
      new Request(
        `http://localhost/api/sleeper/drafts/${auctionDraft.draft_id}`,
      ),
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
      draft_order: { "user-a": 1, "user-b": 2 },
    });
    const mockResponse = await createDraftHandler(mockClient)(
      new Request(
        `http://localhost/api/sleeper/drafts/${auctionDraft.draft_id}`,
      ),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );
    expect(mockResponse.status).toBe(200);
    expect(mockClient.getLeague).not.toHaveBeenCalled();
    expect(mockClient.getPlayers).not.toHaveBeenCalled();
    expect(mockClient.getDraftPicks).toHaveBeenCalledWith(
      auctionDraft.draft_id,
      expect.objectContaining({ next: { revalidate: 2 } }),
    );
    const mockBody = await mockResponse.json();
    expect(Object.keys(mockBody).sort()).toEqual(["snapshot", "warnings"]);
    expect(mockBody.snapshot.teams).toEqual([
      expect.objectContaining({ rosterId: 7, name: "Team 1" }),
      expect.objectContaining({ rosterId: 2, name: "Team 2" }),
    ]);
    expect(mockBody.snapshot.teams.every(
      (team: Record<string, unknown>) => !("userId" in team),
    )).toBe(true);
    expect(mockBody.players).toBeUndefined();
    expect(JSON.stringify(mockBody).length).toBeLessThan(1_000_000);
  });

  it("omits internal pick quarantine details from the public draft response", async () => {
    const mockDraft = {
      ...auctionDraft,
      league_id: null,
      settings: { ...auctionDraft.settings, teams: 2 },
      slot_to_roster_id: { "1": 7, "2": 2 },
      draft_order: { "user-a": 1, "user-b": 2 },
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
              draft_slot: 1,
              pick_no: 1,
              metadata: { amount: "42" },
            },
            {
              draft_id: auctionDraft.draft_id,
              player_id: "bad",
              roster_id: 0,
              draft_slot: 2,
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
      new Request(
        `http://localhost/api/sleeper/drafts/${auctionDraft.draft_id}`,
      ),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot.purchases).toEqual([
      expect.objectContaining({ playerId: "4046", rosterId: 7, amount: 42 }),
    ]);
    expect(Object.keys(body).sort()).toEqual(["snapshot", "warnings"]);
    expect(body.quarantinedPicks).toBeUndefined();
    expect(body.snapshot.teams).toEqual([
      expect.objectContaining({ rosterId: 7, name: "Team 1" }),
      expect.objectContaining({ rosterId: 2, name: "Team 2" }),
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

  it("rate-limits the same client across different usernames without upstream calls", async () => {
    const client = {
      getUser: vi.fn(async (username: string) => ({
        user_id: username,
        display_name: username,
      })),
      getNflState: vi.fn(async () => ({ season: "2026" })),
      getUserDrafts: vi.fn(async () => []),
    };
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: () => 0,
    });
    const GET = createUserDraftsHandler(client, limiter);
    const request = (username: string) =>
      GET(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" },
        }),
        { params: Promise.resolve({ username }) },
      );

    expect((await request("first-user")).status).toBe(200);
    const denied = await request("second-user");
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect(await denied.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Sleeper rate limit reached" },
    });
    expect(client.getUser).toHaveBeenCalledTimes(1);
    expect(client.getNflState).toHaveBeenCalledTimes(1);
  });

  it("rate-limits the same client across different draft IDs without upstream calls", async () => {
    const client = {
      getDraft: vi.fn(async (draftId: string) => ({
        ...auctionDraft,
        draft_id: draftId,
        league_id: null,
      })),
      getDraftPicks: vi.fn(async () => []),
      getLeague: vi.fn(),
      getLeagueUsers: vi.fn(),
      getLeagueRosters: vi.fn(),
    };
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: () => 0,
    });
    const GET = createDraftHandler(client, limiter);
    const request = (draftId: string) =>
      GET(
        new Request("http://localhost", {
          headers: { "x-real-ip": "198.51.100.10" },
        }),
        { params: Promise.resolve({ draftId }) },
      );

    expect((await request("123456789012345678")).status).toBe(200);
    expect((await request("223456789012345678")).status).toBe(429);
    expect(client.getDraft).toHaveBeenCalledTimes(1);
    expect(client.getDraftPicks).toHaveBeenCalledTimes(1);
  });

  it("returns stable 503 without upstream calls when the shared limiter store fails", async () => {
    const rejectingStore: RateLimitStore = {
      increment: vi.fn(async () => {
        throw new Error("redis secret failure");
      }),
      getBlockedUntil: vi.fn(async () => {
        throw new Error("redis secret failure");
      }),
      setBlockedUntil: vi.fn(async () => {
        throw new Error("redis secret failure");
      }),
    };
    const limiter = createRateLimiter({ store: rejectingStore });
    const client = {
      getDraft: vi.fn(),
      getDraftPicks: vi.fn(),
      getLeague: vi.fn(),
      getLeagueUsers: vi.fn(),
      getLeagueRosters: vi.fn(),
    };
    const response = await createDraftHandler(client, limiter)(
      new Request("http://localhost"),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual({
      error: {
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Request protection unavailable",
      },
    });
    expect(serialized).not.toContain("redis secret failure");
    expect(client.getDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["RATE_LIMITED", 429, "Sleeper rate limit reached"],
    ["UPSTREAM", 502, "Sleeper service unavailable"],
    ["MALFORMED", 502, "Sleeper returned malformed data"],
  ] as const)(
    "returns stable draft-route %s errors",
    async (code, status, message) => {
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
    },
  );

  it("passes a bounded upstream rate-limit signal without retrying", async () => {
    let now = 0;
    const limiter = createRateLimiter({
      store: createInMemoryRateLimitStore({ now: () => now }),
      now: () => now,
    });
    const client = {
      getDraft: vi.fn(async () => {
        throw new SleeperError("RATE_LIMITED", 17);
      }),
      getDraftPicks: vi.fn(async () => []),
      getLeague: vi.fn(),
      getLeagueUsers: vi.fn(),
      getLeagueRosters: vi.fn(),
    };
    const GET = createDraftHandler(client, limiter);
    const response = await GET(
      new Request("http://localhost", {
        headers: { "cf-connecting-ip": "198.51.100.17" },
      }),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(client.getDraft).toHaveBeenCalledTimes(1);

    now = 1_000;
    const shortCircuited = await GET(
      new Request("http://localhost", {
        headers: { "cf-connecting-ip": "198.51.100.18" },
      }),
      { params: Promise.resolve({ draftId: "223456789012345678" }) },
    );
    expect(shortCircuited.status).toBe(429);
    expect(shortCircuited.headers.get("Retry-After")).toBe("16");
    expect(await shortCircuited.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Sleeper rate limit reached",
      },
    });
    expect(client.getDraft).toHaveBeenCalledTimes(1);
  });

  it("preserves the original upstream 429 when circuit persistence fails", async () => {
    const store: RateLimitStore = {
      increment: vi.fn(async () => ({ count: 1, retryAfterSeconds: 60 })),
      getBlockedUntil: vi.fn(async () => null),
      setBlockedUntil: vi.fn(async () => {
        throw new Error("redis secret failure");
      }),
    };
    const limiter = createRateLimiter({ store });
    const client = {
      getDraft: vi.fn(async () => {
        throw new SleeperError("RATE_LIMITED", 23);
      }),
      getDraftPicks: vi.fn(async () => []),
      getLeague: vi.fn(),
      getLeagueUsers: vi.fn(),
      getLeagueRosters: vi.fn(),
    };
    const response = await createDraftHandler(client, limiter)(
      new Request("http://localhost"),
      { params: Promise.resolve({ draftId: auctionDraft.draft_id }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("23");
    expect(await response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Sleeper rate limit reached",
      },
    });
  });
});

describe("Sleeper player route", () => {
  it("serves only the compact checked-in snapshot with cache and ETag support", async () => {
    const GET = createPlayersHandler();
    const response = await GET(
      new Request("http://localhost/api/sleeper/players", {
        headers: { "cf-connecting-ip": "198.51.100.22" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.players.length).toBeGreaterThan(500);
    expect(
      body.players.every((player: { position: string }) =>
        ["QB", "RB", "WR", "TE", "K", "DEF"].includes(player.position),
      ),
    ).toBe(true);
    expect(JSON.stringify(body).length).toBeLessThan(1_000_000);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=86400",
    );
    const etag = response.headers.get("ETag");
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);

    const notModified = await GET(
      new Request("http://localhost/api/sleeper/players", {
        headers: {
          "cf-connecting-ip": "198.51.100.23",
          "if-none-match": etag!,
        },
      }),
    );
    expect(notModified.status).toBe(304);

    for (const validator of [`W/${etag}`, `"unrelated", W/${etag}`, "*"]) {
      const conditional = await GET(
        new Request("http://localhost/api/sleeper/players", {
          headers: { "if-none-match": validator },
        }),
      );
      expect(conditional.status).toBe(304);
    }
  });

  it("fails open when the limiter store is unavailable", async () => {
    const rejectingStore: RateLimitStore = {
      increment: vi.fn(async () => {
        throw new Error("redis secret failure");
      }),
      getBlockedUntil: vi.fn(async () => {
        throw new Error("redis secret failure");
      }),
      setBlockedUntil: vi.fn(async () => {
        throw new Error("redis secret failure");
      }),
    };
    const GET = createPlayersHandler(
      createRateLimiter({ store: rejectingStore }),
    );
    const response = await GET(
      new Request("http://localhost/api/sleeper/players"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).players.length).toBeGreaterThan(500);
  });
});
