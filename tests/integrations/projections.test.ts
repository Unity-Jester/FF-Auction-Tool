import { describe, expect, it } from "vitest";

import { parseProjectionCsv } from "@/integrations/projections/csv-provider";
import { createProjectionsHandler } from "@/app/api/projections/route";
import { matchProjectionPlayer } from "@/integrations/projections/match-player";
import {
  createSleeperProjectionProvider,
  normalizeSleeperProjections,
} from "@/integrations/projections/sleeper-provider";
import type { ProjectionSnapshot } from "@/integrations/projections/types";

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
        full_name: `Player ${index}`,
        team: "BUF",
        position: "QB",
        stats: { pass_yd: 3000 },
      })),
    });
    await expect(provider.load()).resolves.toMatchObject({ stale: false });
  });

  it("normalizes the current Sleeper projection response shape", () => {
    const normalized = normalizeSleeperProjections(
      {
        "4046": {
          player_id: "4046",
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
      "2026-07-25T12:00:00.000Z",
    );

    expect(normalized[0]).toMatchObject({
      playerId: "4046",
      stats: { passYards: 4100, passTds: 31 },
    });
    expect(normalizeSleeperProjections([
      { player_id: "4046", player: { full_name: "Josh Allen", team: "BUF", position: "QB" }, stats: {} },
      { player_id: "4046", player: { full_name: "Duplicate", team: "BUF", position: "QB" }, stats: {} },
    ], "2026-07-25T12:00:00.000Z")).toHaveLength(1);
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
