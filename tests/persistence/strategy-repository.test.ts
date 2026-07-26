import { describe, expect, it, vi } from "vitest";

import { defaultStrategy } from "@/features/strategy/default-strategies";
import { createLeagueConfig } from "@/domain/league/defaults";
import {
  MAX_STRATEGY_BYTES,
  type SavedStrategy,
} from "@/persistence/saved-strategy-repository";
import { BrowserStrategyRepository } from "@/persistence/browser-strategy-repository";
import {
  SupabaseStrategyRepository,
  type StrategySupabaseClient,
} from "@/persistence/supabase-strategy-repository";
import { selectStrategyRepository } from "@/persistence/strategy-repository-selector";

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
  } as unknown as StrategySupabaseClient;
  return { client, query, setRows: (value: Record<string, unknown>[]) => { rows = value; } };
}

describe("saved strategy repository contract", () => {
  it("saves, lists, and removes browser strategies", async () => {
    const repository = new BrowserStrategyRepository(memoryStorage());
    await repository.save(saved);
    expect(await repository.list()).toEqual([saved]);
    await repository.remove(saved.id);
    expect(await repository.list()).toEqual([]);
  });

  it("saves only allowed columns and validates returned Supabase rows", async () => {
    const mock = supabaseMock();
    const repository = new SupabaseStrategyRepository(mock.client, "user-1");
    await repository.save(saved);
    expect(mock.query.upsert).toHaveBeenCalledWith({
      id: saved.id,
      user_id: "user-1",
      name: saved.name,
      strategy: saved.strategy,
      created_at: saved.createdAt,
      updated_at: saved.updatedAt,
    });
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

  it("rejects malformed Supabase rows and sanitizes provider errors", async () => {
    const mock = supabaseMock();
    mock.setRows([{ id: "not-a-uuid", name: "bad" }]);
    const repository = new SupabaseStrategyRepository(mock.client, "user-1");
    await expect(repository.list()).rejects.toThrow(
      "Saved strategies could not be read safely.",
    );
    mock.query.upsert.mockResolvedValueOnce({
      data: null,
      error: { message: "token=secret internal details" },
    } as never);
    await expect(repository.save(saved)).rejects.toThrow(
      "The strategy could not be saved.",
    );
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
    )).toBe(createCloud.mock.results[0]?.value);
  });
});
