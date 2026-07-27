import { describe, expect, it, vi } from "vitest";

import { parseProjectionCsv } from "@/integrations/projections/csv-provider";
import { createProjectionsHandler } from "@/app/api/projections/route";
import { matchProjectionPlayer } from "@/integrations/projections/match-player";
import {
  createSleeperProjectionProvider,
  normalizeSleeperProjections,
  validateProjectionSnapshot,
} from "@/integrations/projections/sleeper-provider";
import type { ProjectionSnapshot } from "@/integrations/projections/types";
import futureShell from "../fixtures/projections/future-shell.json";

const lastKnownSnapshot: ProjectionSnapshot = {
  source: "Sleeper season projections (checked-in fallback)",
  updatedAt: "2026-07-20T00:00:00.000Z",
  stale: false,
  projections: [
    {
      playerId: "4046",
      name: "Josh Allen",
      team: "BUF",
      positions: ["QB"],
      stats: { passYards: 4100, passTds: 31, interceptions: 10 },
      source: "Sleeper season projections (checked-in fallback)",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  ],
};

describe("Sleeper projection provider", () => {
  it("marks a validated upstream snapshot as fresh", async () => {
    const provider = createSleeperProjectionProvider({
      season: 2026,
      fallback: lastKnownSnapshot,
      fetcher: async () => Array.from({ length: 100 }, (_, index) => ({
        player_id: String(index),
        season: "2026",
        season_type: "regular",
        updated_at: 1785000000000 + index,
        full_name: `Player ${index}`,
        team: "BUF",
        position: "QB",
        stats: { pass_yd: 3000 },
      })),
    });
    await expect(provider.load()).resolves.toMatchObject({ stale: false });
  });

  it("rejects realistic future-season shells with no supported statistics", async () => {
    const payload = Array.from({ length: 100 }, (_, index) => ({
      ...futureShell[0],
      player_id: String(index),
    }));
    expect(normalizeSleeperProjections(payload, 2027).projections).toEqual([]);
    const provider = createSleeperProjectionProvider({ season: 2027, fallback: lastKnownSnapshot, fetcher: async () => payload });
    await expect(provider.load()).resolves.toMatchObject({ stale: true, updatedAt: lastKnownSnapshot.updatedAt });
  });

  it("rejects snapshots whose players have no supported scoring statistic", () => {
    expect(() => validateProjectionSnapshot({
      source: "invalid",
      updatedAt: "2026-07-25T00:00:00.000Z",
      projections: [{ ...lastKnownSnapshot.projections[0], stats: { unsupported: 1 } as never }],
    }, 1)).toThrow("Invalid projection record");
  });

  it("uses accepted Sleeper metadata for update time and rejects wrong season or season type", () => {
    const normalized = normalizeSleeperProjections([
      { player_id: "1", season: "2026", season_type: "regular", updated_at: 1785000000000, stats: { pass_yd: 4000 }, player: { full_name: "Valid One", position: "QB", team: "BUF" } },
      { player_id: "2", season: "2026", season_type: "regular", last_modified: 1785000010000, stats: { rush_yd: 900 }, player: { full_name: "Valid Two", position: "RB", team: "JAX" } },
      { player_id: "3", season: "2025", season_type: "regular", updated_at: 1999999999999, stats: { rec: 80 }, player: { full_name: "Wrong Season", position: "WR", team: "BUF" } },
      { player_id: "4", season: "2026", season_type: "post", updated_at: 1999999999999, stats: { rec: 80 }, player: { full_name: "Wrong Type", position: "WR", team: "BUF" } },
    ], 2026);
    expect(normalized.projections.map((projection) => projection.playerId)).toEqual(["1", "2"]);
    expect(normalized.updatedAt).toBe("2026-07-25T17:20:10.000Z");
    expect(normalized.projections.every((projection) => projection.updatedAt === normalized.updatedAt)).toBe(true);
  });

  it("falls back on oversized and timed-out projection responses", async () => {
    const oversized = createSleeperProjectionProvider({
      season: 2026,
      fallback: lastKnownSnapshot,
      request: async () => new Response("[]", { headers: { "Content-Length": String(13 * 1024 * 1024) } }),
    });
    await expect(oversized.load()).resolves.toMatchObject({ stale: true });
    const streamedOversized = createSleeperProjectionProvider({
      season: 2026,
      fallback: lastKnownSnapshot,
      request: async () => new Response(new Uint8Array(13 * 1024 * 1024)),
    });
    await expect(streamedOversized.load()).resolves.toMatchObject({ stale: true });

    vi.useFakeTimers();
    const timedOut = createSleeperProjectionProvider({
      season: 2026,
      fallback: lastKnownSnapshot,
      timeoutMs: 10,
      request: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    });
    const loading = timedOut.load();
    await vi.advanceTimersByTimeAsync(11);
    await expect(loading).resolves.toMatchObject({ stale: true });
    vi.useRealTimers();
  });

  it("normalizes the current Sleeper projection response shape", () => {
    const normalized = normalizeSleeperProjections(
      {
        "4046": {
          player_id: "4046",
          season: "2026",
          season_type: "regular",
          updated_at: 1785000000000,
          full_name: "Josh Allen",
          team: "BUF",
          position: "QB",
          stats: {
            pass_yd: 4100,
            pass_td: 31,
            pass_int: 10,
            rush_yd: 550,
            rush_td: 7,
            rec: 0,
            rec_yd: 0,
            rec_td: 0,
            fum_lost: 3,
          },
        },
      },
      2026,
    );

    expect(normalized.projections[0]).toMatchObject({
      playerId: "4046",
      stats: { passYards: 4100, passTds: 31 },
    });
    expect(normalizeSleeperProjections([
      { player_id: "4046", season: "2026", season_type: "regular", updated_at: 1785000000000, player: { full_name: "Josh Allen", team: "BUF", position: "QB" }, stats: { pass_yd: 4000 } },
      { player_id: "4046", season: "2026", season_type: "regular", updated_at: 1785000000000, player: { full_name: "Duplicate", team: "BUF", position: "QB" }, stats: { pass_yd: 1 } },
    ], 2026).projections).toHaveLength(1);
  });

  it("keeps the last valid snapshot when upstream fails, is malformed, or empty", async () => {
    for (const body of [undefined, {}, []]) {
      const provider = createSleeperProjectionProvider({
        season: 2026,
        fallback: lastKnownSnapshot,
        fetcher: async () => {
          if (body === undefined) throw new Error("network down");
          return body;
        },
      });
      await expect(provider.load()).resolves.toEqual({
        ...lastKnownSnapshot,
        stale: true,
      });
    }
  });

  it("deduplicates upstream records and returns a cacheable controlled route response", async () => {
    const snapshot = { ...lastKnownSnapshot, stale: false };
    const response = await createProjectionsHandler({ load: async () => snapshot })();
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=21600, stale-while-revalidate=86400");
    await expect(response.json()).resolves.toEqual(snapshot);
    const unavailable = await createProjectionsHandler({ load: async () => { throw new Error("bad upstream"); } })();
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({ error: { code: "PROJECTIONS_UNAVAILABLE" } });
  });
});

describe("CSV projections", () => {
  const players = [
    { playerId: "4046", name: "Josh Allen", team: "BUF", positions: ["QB"] },
    { playerId: "1", name: "A. Brown", team: "PHI", positions: ["WR"] },
    { playerId: "2", name: "A. Brown", team: "WAS", positions: ["WR"] },
    { playerId: "3", name: "Bears", team: "CHI", positions: ["DEF"] },
    { playerId: "4", name: "Free Agent", team: null, positions: ["RB"] },
    { playerId: "5", name: "Jacksonville Player", team: "JAX", positions: ["WR"] },
  ] as const;

  it("matches IDs first and otherwise requires name, compatible position, and team", () => {
    const result = parseProjectionCsv(
      [
        "player_id,name,team,position,pass_yd,pass_td,rec,rec_yd,rec_td",
        "4046,Wrong Name,NO,QB,4100,31,0,0,0",
        ",A. Brown,PHI,WR,0,0,80,1000,8",
        ",Unknown Player,ZZZ,WR,0,0,1,1,0",
      ].join("\n"),
      players,
    );

    expect(result.matched).toHaveLength(2);
    expect(result.unmatched).toEqual([
      expect.objectContaining({ sourceName: "Unknown Player" }),
    ]);
    expect(result.matched[0]).toMatchObject({
      playerId: "4046",
      stats: { passYards: 4100, passTds: 31 },
    });
  });

  it("matches explicit free-agent teams and Jacksonville aliases", () => {
    expect(matchProjectionPlayer({ name: "Free Agent", team: "NONE", position: "RB" }, players)).toMatchObject({ kind: "matched", player: { playerId: "4" } });
    expect(matchProjectionPlayer({ name: "Jacksonville Player", team: "JAC", position: "WR" }, players)).toMatchObject({ kind: "matched", player: { playerId: "5" } });
  });

  it("works in a browser without Buffer and quarantines duplicate player rows", () => {
    const originalBuffer = globalThis.Buffer;
    // @ts-expect-error Simulate a browser runtime without Node globals.
    globalThis.Buffer = undefined;
    try {
      const result = parseProjectionCsv([
        "player_id,name,team,position,pass_yd",
        "4046,Josh Allen,BUF,QB,4000",
        "4046,Josh Allen,BUF,QB,4100",
      ].join("\n"), players);
      expect(result.matched).toHaveLength(0);
      expect(result.duplicates).toEqual([
        expect.objectContaining({ playerId: "4046" }),
        expect.objectContaining({ playerId: "4046" }),
      ]);
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });

  it("never auto-matches ambiguous names and rejects unsafe or unsupported values", () => {
    expect(matchProjectionPlayer({ name: "A. Brown", position: "WR" }, players)).toEqual({
      kind: "ambiguous",
      candidates: ["1", "2"],
    });
    expect(matchProjectionPlayer({ name: "Bears", team: "CHI", position: "D/ST" }, players)).toMatchObject({
      kind: "matched",
      player: { playerId: "3" },
    });
    const result = parseProjectionCsv(
      [
        "name,team,position,rec,__proto__,unknown",
        "Bears,CHI,DEF,=2+2,poison,999",
        "Josh Allen,BUF,QB,10,poison,999",
      ].join("\n"),
      players,
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unsupported).toHaveLength(2);
  });
});
