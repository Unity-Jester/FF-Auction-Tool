import { describe, expect, it, vi } from "vitest";

import { createDraftHandler } from "@/app/api/sleeper/drafts/[draftId]/route";
import { createUserDraftsHandler } from "@/app/api/sleeper/users/[username]/drafts/route";
import { SleeperClient } from "@/integrations/sleeper/client";
import {
  createRateLimiter,
  createUpstashRateLimitStore,
  requestClientKey,
} from "@/integrations/sleeper/rate-limiter";

const auctionDraft = {
  draft_id: "123456789012345678",
  type: "auction",
  status: "drafting",
  league_id: null,
  settings: {
    teams: 2,
    budget: 200,
    slots_qb: 1,
    slots_rb: 2,
    slots_wr: 2,
    slots_te: 1,
    slots_bn: 5,
  },
  metadata: {},
  slot_to_roster_id: { "1": 1, "2": 2 },
  draft_order: { "user-1": 1, "user-2": 2 },
};

describe("bounded Sleeper requests", () => {
  it("combines caller cancellation with a request timeout", async () => {
    vi.useFakeTimers();
    try {
      let timeoutSignal: AbortSignal | undefined;
      const timedOut = new SleeperClient(
        vi.fn((_url, init) => {
          timeoutSignal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("secret timeout detail", "AbortError"));
            });
          });
        }),
        undefined,
        { timeoutMs: 10 },
      );
      const timeoutRequest = timedOut.getDraft(auctionDraft.draft_id);
      const timeoutRejection = expect(timeoutRequest).rejects.toMatchObject({
        code: "UPSTREAM",
        message: "Sleeper service unavailable",
      });
      await vi.advanceTimersByTimeAsync(11);
      await timeoutRejection;
      expect(timeoutSignal?.aborted).toBe(true);

      const caller = new AbortController();
      let callerSignal: AbortSignal | undefined;
      const cancelled = new SleeperClient(
        vi.fn((_url, init) => {
          callerSignal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("secret caller detail", "AbortError"));
            });
          });
        }),
      );
      const callerRequest = cancelled.getDraft(auctionDraft.draft_id, {
        signal: caller.signal,
      });
      caller.abort();
      await expect(callerRequest).rejects.toMatchObject({
        code: "UPSTREAM",
        message: "Sleeper service unavailable",
      });
      expect(callerSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects declared and streamed oversized bodies before JSON parsing", async () => {
    const declared = new SleeperClient(
      vi.fn(async () =>
        new Response("{}", { headers: { "Content-Length": "33" } }),
      ),
      undefined,
      { maxResponseBytes: 32 },
    );
    await expect(declared.getDraft(auctionDraft.draft_id)).rejects.toMatchObject({
      code: "MALFORMED",
      message: "Sleeper returned malformed data",
    });

    let cancelled = false;
    const streamedChunks = [
      new TextEncoder().encode("x".repeat(20)),
      new TextEncoder().encode("secret".repeat(4)),
    ];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = streamedChunks.shift();
        if (chunk) controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamed = new SleeperClient(
      vi.fn(async () => new Response(body)),
      undefined,
      { maxResponseBytes: 32 },
    );
    await expect(streamed.getDraft(auctionDraft.draft_id)).rejects.toMatchObject({
      code: "MALFORMED",
      message: "Sleeper returned malformed data",
    });
    expect(cancelled).toBe(true);
  });

  it("still parses a normal bounded response", async () => {
    const client = new SleeperClient(
      vi.fn(async () => new Response(JSON.stringify(auctionDraft))),
      undefined,
      { timeoutMs: 50, maxResponseBytes: 10_000 },
    );
    await expect(client.getDraft(auctionDraft.draft_id)).resolves.toMatchObject({
      draft_id: auctionDraft.draft_id,
      type: "auction",
    });
  });

  it("passes route request cancellation through discovery and draft polling", async () => {
    const discoveryLimiter = {
      check: vi.fn(async () => ({ allowed: true })),
      blockFor: vi.fn(async () => true),
      size: 0,
    };
    const discoverySignals: Array<AbortSignal | null | undefined> = [];
    const discovery = {
      getUser: vi.fn(async (_value, options) => {
        discoverySignals.push(options?.signal);
        return { user_id: "user-1", display_name: "Guest" };
      }),
      getNflState: vi.fn(async (options) => {
        discoverySignals.push(options?.signal);
        return { season: "2026" };
      }),
      getUserDrafts: vi.fn(async (_user, _season, options) => {
        discoverySignals.push(options?.signal);
        return [];
      }),
    };
    const discoveryRequest = new Request(
      "http://localhost/api/sleeper/users/Guest/drafts",
    );
    const discoveryResponse = await createUserDraftsHandler(
      discovery,
      discoveryLimiter,
    )(
      discoveryRequest,
      { params: Promise.resolve({ username: "Guest" }) },
    );
    expect(discoveryResponse.status).toBe(200);
    expect(discoveryLimiter.check).toHaveBeenCalledWith(
      "global",
      discoveryRequest.signal,
    );
    expect(discoverySignals).toEqual([
      discoveryRequest.signal,
      discoveryRequest.signal,
      discoveryRequest.signal,
    ]);

    const draftLimiter = {
      check: vi.fn(async () => ({ allowed: true })),
      blockFor: vi.fn(async () => true),
      size: 0,
    };
    const draftSignals: Array<AbortSignal | null | undefined> = [];
    const detail = {
      getDraft: vi.fn(async (_value, options) => {
        draftSignals.push(options?.signal);
        return auctionDraft;
      }),
      getDraftPicks: vi.fn(async (_value, options) => {
        draftSignals.push(options?.signal);
        return [];
      }),
      getLeague: vi.fn(),
      getLeagueUsers: vi.fn(),
      getLeagueRosters: vi.fn(),
    };
    const draftRequest = new Request(
      `http://localhost/api/sleeper/drafts/${auctionDraft.draft_id}`,
    );
    const draftResponse = await createDraftHandler(
      detail,
      draftLimiter,
    )(draftRequest, {
      params: Promise.resolve({ draftId: auctionDraft.draft_id }),
    });
    expect(draftResponse.status).toBe(200);
    expect(draftLimiter.check).toHaveBeenCalledWith(
      "global",
      draftRequest.signal,
    );
    expect(draftSignals).toEqual([draftRequest.signal, draftRequest.signal]);
    expect(draftResponse.headers.get("Cache-Control")).toBe(
      "public, s-maxage=1, stale-while-revalidate=2",
    );
  });
});

describe("shared limiter privacy and command ceiling", () => {
  it("times out a non-settling Upstash request and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      let transportSignal: AbortSignal | undefined;
      const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
        transportSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });
      const store = createUpstashRateLimitStore({
        url: "https://example.upstash.io",
        token: "test-token",
        fetchFn,
        timeoutMs: 10,
      });
      const limiter = createRateLimiter({ store });

      const decision = limiter.check("hashed-client");
      await vi.advanceTimersByTimeAsync(11);

      await expect(decision).resolves.toEqual({
        allowed: true,
        storeUnavailable: true,
      });
      expect(transportSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a non-settling Upstash response body", async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const store = createUpstashRateLimitStore({
        url: "https://example.upstash.io",
        token: "test-token",
        timeoutMs: 10,
        fetchFn: vi.fn(async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull() {
                return new Promise<void>(() => undefined);
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
        ),
      });

      const request = store.increment("hashed-client", 60_000);
      const rejection = expect(request).rejects.toThrow(
        "Shared rate-limit store unavailable",
      );
      await vi.advanceTimersByTimeAsync(11);

      await rejection;
      expect(cancelled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects declared and streamed oversized Upstash responses", async () => {
    const declaredStore = createUpstashRateLimitStore({
      url: "https://example.upstash.io",
      token: "test-token",
      maxResponseBytes: 32,
      fetchFn: vi.fn(async () =>
        new Response("{}", { headers: { "Content-Length": "33" } }),
      ),
    });
    await expect(
      declaredStore.increment("hashed-client", 60_000),
    ).rejects.toThrow("Shared rate-limit store unavailable");

    let cancelled = false;
    const chunks = [
      new TextEncoder().encode("x".repeat(20)),
      new TextEncoder().encode("secret".repeat(4)),
    ];
    const streamedStore = createUpstashRateLimitStore({
      url: "https://example.upstash.io",
      token: "test-token",
      maxResponseBytes: 32,
      fetchFn: vi.fn(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              const chunk = chunks.shift();
              if (chunk) controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      ),
    });
    await expect(
      streamedStore.increment("hashed-client", 60_000),
    ).rejects.toThrow("Shared rate-limit store unavailable");
    expect(cancelled).toBe(true);
  });

  it("combines caller cancellation with a normal bounded atomic response without leaking timers", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      let cancelledSignal: AbortSignal | undefined;
      const cancelledStore = createUpstashRateLimitStore({
        url: "https://example.upstash.io",
        token: "test-token",
        timeoutMs: 50,
        fetchFn: vi.fn((_url: string, init?: RequestInit) => {
          cancelledSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        }),
      });
      const cancelled = cancelledStore.increment(
        "hashed-client",
        60_000,
        caller.signal,
      );
      caller.abort();
      await expect(cancelled).rejects.toThrow(
        "Shared rate-limit store unavailable",
      );
      expect(cancelledSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);

      const normalStore = createUpstashRateLimitStore({
        url: "https://example.upstash.io",
        token: "test-token",
        timeoutMs: 50,
        maxResponseBytes: 1_024,
        fetchFn: vi.fn(async () =>
          new Response(JSON.stringify({ result: [3, 5_000] })),
        ),
      });
      await expect(
        normalStore.increment("hashed-client", 60_000),
      ).resolves.toEqual({ count: 3, retryAfterSeconds: 5 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses one atomic Upstash command per rate-limit check", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as unknown[];
      if (command[0] === "EVAL") {
        return new Response(JSON.stringify({ result: [0, 1, 60_000] }));
      }
      return new Response(JSON.stringify({ result: null }));
    });
    const store = createUpstashRateLimitStore({
      url: "https://example.upstash.io",
      token: "test-token",
      fetchFn,
    });
    const limiter = createRateLimiter({ store, now: () => 0 });

    await expect(limiter.check("hashed-client")).resolves.toEqual({
      allowed: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const command = JSON.parse(
      String(fetchFn.mock.calls[0]?.[1]?.body),
    ) as unknown[];
    expect(command[0]).toBe("EVAL");
    expect(JSON.stringify(command)).toContain("sleeper:blocked-until");
    expect(String(command[1])).toContain("INCR");
  });

  it("uses stable keyed hashes and never returns a raw trusted IP", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.99, 10.0.0.1" },
    });
    const options = {
      environment: { TRUST_PROXY: "true" },
      keySecret: "unit-test-secret",
    };
    const first = requestClientKey(request, options);
    const second = requestClientKey(request, options);

    expect(first).toBe(second);
    expect(first).toMatch(/^client:[a-f0-9]{64}$/);
    expect(first).not.toContain("198.51.100.99");
  });

  it("does not treat an empty optional HMAC key as a configured secret", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.99" },
    });
    const fromFallbackToken = requestClientKey(request, {
      environment: {
        TRUST_PROXY: "true",
        RATE_LIMIT_KEY_SECRET: "",
        UPSTASH_REDIS_REST_TOKEN: "shared-fallback-token",
      },
    });
    const fromExplicitToken = requestClientKey(request, {
      environment: { TRUST_PROXY: "true" },
      keySecret: "shared-fallback-token",
    });

    expect(fromFallbackToken).toBe(fromExplicitToken);
  });
});
