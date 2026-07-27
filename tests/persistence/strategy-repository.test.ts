import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultStrategy } from "@/features/strategy/default-strategies";
import { createLeagueConfig } from "@/domain/league/defaults";
import {
  MAX_STRATEGY_BYTES,
  estimatedPostgresJsonBytes,
  type SavedStrategy,
} from "@/persistence/saved-strategy-repository";
import { BrowserStrategyRepository } from "@/persistence/browser-strategy-repository";
import {
  SupabaseStrategyRepository,
  type StrategySupabaseClient,
} from "@/persistence/supabase-strategy-repository";
import { selectStrategyRepository } from "@/persistence/strategy-repository-selector";
import { parsePublicSupabaseConfig } from "@/integrations/supabase/config";

const league = createLeagueConfig({
  teams: 12,
  budget: 200,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
  bench: 6,
  flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
  receptionPoints: 1,
});

const saved: SavedStrategy = {
  id: "3ca44572-fbef-44c7-9b93-334f44632a44",
  name: "Home league",
  strategy: defaultStrategy(league),
  createdAt: "2026-07-26T12:00:00.000Z",
  updatedAt: "2026-07-26T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function supabaseMock() {
  let rows: Record<string, unknown>[] = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(async () => ({ data: rows, error: null })),
    upsert: vi.fn(async (row: Record<string, unknown>) => {
      rows = [row];
      return { data: null, error: null };
    }),
    delete: vi.fn(() => query),
    then: (
      resolve: (value: { data: null; error: null }) => unknown,
    ) => resolve({ data: null, error: null }),
  };
  const client = {
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as StrategySupabaseClient;
  return {
    client,
    query,
    rpc: (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc,
    setRows: (value: Record<string, unknown>[]) => { rows = value; },
  };
}

describe("saved strategy repository contract", () => {
  it("saves, lists, and removes browser strategies", async () => {
    const repository = new BrowserStrategyRepository(memoryStorage());
    await repository.save(saved);
    expect(await repository.list()).toEqual([saved]);
    await repository.remove(saved.id);
    expect(await repository.list()).toEqual([]);
  });

  it("saves only allowed fields through the quota-enforcing database function", async () => {
    const mock = supabaseMock();
    const repository = new SupabaseStrategyRepository(mock.client, "user-1");
    await repository.save(saved);
    expect(mock.rpc).toHaveBeenCalledWith("save_strategy", {
      p_id: saved.id,
      p_name: saved.name,
      p_strategy: saved.strategy,
    });
    expect(mock.query.upsert).not.toHaveBeenCalled();
  });

  it("maps returned rows without exposing extra cloud columns", async () => {
    const mock = supabaseMock();
    const repository = new SupabaseStrategyRepository(mock.client, "user-1");
    mock.setRows([{
      id: saved.id,
      name: saved.name,
      strategy: saved.strategy,
      created_at: saved.createdAt,
      updated_at: saved.updatedAt,
      user_id: "another-user",
      secret: "must not escape",
    }]);
    expect(await repository.list()).toEqual([saved]);
    await repository.remove(saved.id);
    expect(mock.query.eq).toHaveBeenCalledWith("id", saved.id);
  });

  it("rejects invalid records and oversized strategies before storage", async () => {
    const repository = new BrowserStrategyRepository(memoryStorage());
    await expect(repository.save({ ...saved, name: " ".repeat(81) })).rejects.toThrow(
      "Strategy name must be between 1 and 80 characters.",
    );
    const huge = {
      ...saved,
      strategy: {
        ...saved.strategy,
        valueOverrides: Object.fromEntries(
          Array.from(
            { length: Math.ceil(MAX_STRATEGY_BYTES / 10) },
            (_, index) => [`player-${index}`, index],
          ),
        ),
      },
    };
    await expect(repository.save(huge)).rejects.toThrow("32 KB");
  });

  it("rejects compact JSON that PostgreSQL jsonb text could expand past 32 KB", async () => {
    const valueOverrides: Record<string, number> = {};
    let index = 0;
    const strategy = { ...saved.strategy, valueOverrides };
    while (new TextEncoder().encode(JSON.stringify(strategy)).byteLength < 31_000) {
      valueOverrides[`p${index}`] = index;
      index += 1;
    }
    expect(new TextEncoder().encode(JSON.stringify(strategy)).byteLength)
      .toBeLessThan(MAX_STRATEGY_BYTES);
    expect(estimatedPostgresJsonBytes(strategy)).toBeGreaterThan(
      MAX_STRATEGY_BYTES,
    );
    await expect(new BrowserStrategyRepository(memoryStorage()).save({
      ...saved,
      strategy,
    })).rejects.toThrow("32 KB");
  });

  it("accounts for PostgreSQL expanding exponential numbers in jsonb text", async () => {
    const strategy = {
      ...saved.strategy,
      valueOverrides: Object.fromEntries(
        Array.from({ length: 1_900 }, (_, index) => [`p${index}`, 1e-7]),
      ),
    };
    expect(new TextEncoder().encode(JSON.stringify(strategy)).byteLength)
      .toBeLessThan(MAX_STRATEGY_BYTES);
    expect(estimatedPostgresJsonBytes(strategy)).toBeGreaterThan(
      MAX_STRATEGY_BYTES,
    );
    await expect(new BrowserStrategyRepository(memoryStorage()).save({
      ...saved,
      strategy,
    })).rejects.toThrow("32 KB");
  });

  it("recovers from malformed or unavailable browser storage", async () => {
    const malformed = memoryStorage();
    malformed.setItem("sleeper-auction-companion:saved-strategies:v1", "{bad");
    expect(await new BrowserStrategyRepository(malformed).list()).toEqual([]);
    const unavailable = {
      ...memoryStorage(),
      getItem: () => { throw new DOMException("blocked"); },
      setItem: () => { throw new DOMException("quota"); },
    };
    expect(await new BrowserStrategyRepository(unavailable).list()).toEqual([]);
    await expect(new BrowserStrategyRepository(unavailable).save(saved)).rejects.toThrow(
      "This browser could not save the strategy.",
    );
  });

  it("quarantines malformed Supabase rows and reports a safe warning", async () => {
    const mock = supabaseMock();
    mock.setRows([
      { id: "not-a-uuid", name: "bad" },
      {
        id: saved.id,
        name: saved.name,
        strategy: saved.strategy,
        created_at: saved.createdAt,
        updated_at: saved.updatedAt,
      },
    ]);
    const repository = new SupabaseStrategyRepository(mock.client, "user-1");
    expect(await repository.list()).toEqual([saved]);
    expect(repository.getWarnings()).toEqual([
      "Some cloud strategies were skipped because they were invalid.",
    ]);
  });

  it("maps quota errors to a stable friendly message and sanitizes other errors", async () => {
    const mock = supabaseMock();
    const repository = new SupabaseStrategyRepository(mock.client, "user-1");
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "saved_strategy_quota_exceeded" },
    });
    await expect(repository.save(saved)).rejects.toThrow(
      "You can save up to 50 named strategies.",
    );
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "token=secret internal details" },
    } as never);
    await expect(repository.save(saved)).rejects.toThrow(
      "The strategy could not be saved.",
    );
  });

  it("surfaces one quota error for parallel creates and still permits updates at 50", async () => {
    const ids = new Set(
      Array.from({ length: 49 }, (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    );
    let queue = Promise.resolve();
    const rpc = vi.fn(
      (_fn: "save_strategy", args: { p_id: string }) => {
        const operation = queue.then(() => {
          if (ids.has(args.p_id)) return { data: null, error: null };
          if (ids.size >= 50) {
            return {
              data: null,
              error: {
                code: "P0001",
                message: "saved_strategy_quota_exceeded",
              },
            };
          }
          ids.add(args.p_id);
          return { data: null, error: null };
        });
        queue = operation.then(() => undefined);
        return operation;
      },
    );
    const client = {
      from: vi.fn(),
      rpc,
    } as unknown as StrategySupabaseClient;
    const repository = new SupabaseStrategyRepository(client, "user-1");
    const first = {
      ...saved,
      id: "84823154-9463-4a78-a29b-3a3d6d640d31",
    };
    const second = {
      ...saved,
      id: "9aff321f-2db0-444f-ad67-98213d5d7cee",
    };

    const results = await Promise.allSettled([
      repository.save(first),
      repository.save(second),
    ]);

    expect(ids.size).toBe(50);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected"))
      .toMatchObject({
        reason: new Error("You can save up to 50 named strategies."),
      });
    const accepted = results[0]?.status === "fulfilled" ? first : second;
    await expect(repository.save({
      ...accepted,
      name: "Updated existing plan",
    })).resolves.toBeUndefined();
    expect(ids.size).toBe(50);
  });

  it("treats empty environment values as disabled guest mode", () => {
    expect(() =>
      parsePublicSupabaseConfig({
        url: "",
        publishableKey: "",
        anonKey: "",
      }),
    ).not.toThrow();
    expect(
      parsePublicSupabaseConfig({
        url: "",
        publishableKey: "",
        anonKey: "",
      }),
    ).toBeNull();
  });

  it("prefers a publishable key while retaining legacy anon-key fallback", () => {
    expect(parsePublicSupabaseConfig({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_current",
      anonKey: "legacy",
    })).toEqual({
      url: "https://project.supabase.co",
      publicKey: "sb_publishable_current",
    });
    expect(parsePublicSupabaseConfig({
      url: "https://project.supabase.co",
      anonKey: "legacy",
    })).toEqual({
      url: "https://project.supabase.co",
      publicKey: "legacy",
    });
    const legacyAnonJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb2plY3QiLCJyb2xlIjoiYW5vbiJ9." +
      "signature";
    expect(parsePublicSupabaseConfig({
      url: "https://project.supabase.co",
      anonKey: legacyAnonJwt,
    })).toEqual({
      url: "https://project.supabase.co",
      publicKey: legacyAnonJwt,
    });
    expect(parsePublicSupabaseConfig({
      url: "https://project.supabase.co",
      publishableKey: "sb_secret_must-never-reach-browser",
    })).toBeNull();
    expect(parsePublicSupabaseConfig({
      url: "https://project.supabase.co",
      anonKey:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb2plY3QiLCJyb2xlIjoic2VydmljZV9yb2xlIn0." +
        "signature",
    })).toBeNull();
  });

  it("serializes concurrent browser saves without losing either record", async () => {
    const storage = memoryStorage();
    const first = new BrowserStrategyRepository(storage);
    const second = new BrowserStrategyRepository(storage);
    await Promise.all([
      first.save(saved),
      second.save({
        ...saved,
        id: "84823154-9463-4a78-a29b-3a3d6d640d31",
        name: "Second plan",
      }),
    ]);
    expect((await first.list()).map((item) => item.name).sort()).toEqual([
      "Home league",
      "Second plan",
    ]);
  });

  it("serializes a concurrent browser save and remove", async () => {
    const storage = memoryStorage();
    const first = new BrowserStrategyRepository(storage);
    const second = new BrowserStrategyRepository(storage);
    await first.save(saved);
    await Promise.all([
      first.save({
        ...saved,
        id: "84823154-9463-4a78-a29b-3a3d6d640d31",
        name: "Second plan",
      }),
      second.remove(saved.id),
    ]);
    expect((await first.list()).map((item) => item.name)).toEqual(["Second plan"]);
  });

  it("sanitizes a failed cross-tab lock without mutating storage", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn().mockRejectedValue(new Error("internal lock secret")),
      },
    });
    await expect(new BrowserStrategyRepository(storage).save(saved)).rejects.toThrow(
      "This browser could not save the strategy.",
    );
    expect(storage.getItem("sleeper-auction-companion:saved-strategies:v1")).toBeNull();
  });

  it("bounds the no-Web-Locks cross-tab fallback when another tab holds it", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    storage.setItem(
      "sleeper-auction-companion:saved-strategies:lock:foreign-tab",
      JSON.stringify({
        owner: "foreign-tab",
        choosing: false,
        ticket: 1,
        expiresAt: Date.now() + 10_000,
      }),
    );
    const saving = new BrowserStrategyRepository(storage).save(saved);
    const rejection = expect(saving).rejects.toThrow(
      "This browser could not save the strategy.",
    );

    await vi.advanceTimersByTimeAsync(2_100);

    await rejection;
    expect(storage.getItem("sleeper-auction-companion:saved-strategies:v1")).toBeNull();
  });

  it("uses browser storage unless complete config and a session are present", async () => {
    const storage = memoryStorage();
    const createCloud = vi.fn();
    expect(await selectStrategyRepository({}, null, storage, createCloud))
      .toBeInstanceOf(BrowserStrategyRepository);
    expect(await selectStrategyRepository(
      { url: "https://project.supabase.co", anonKey: "" },
      { user: { id: "user-1" } },
      storage,
      createCloud,
    )).toBeInstanceOf(BrowserStrategyRepository);
    expect(await selectStrategyRepository(
      { url: "https://project.supabase.co", anonKey: "public-anon-key" },
      { user: { id: "user-1" } },
      storage,
      createCloud,
    )).toBeInstanceOf(BrowserStrategyRepository);
    expect(await selectStrategyRepository(
      {
        url: "https://project.supabase.co",
        anonKey: "public-anon-key",
        captchaSiteKey: "captcha-site-key",
      },
      { user: { id: "user-1" } },
      storage,
      createCloud,
    )).toBe(createCloud.mock.results[0]?.value);
  });
});
