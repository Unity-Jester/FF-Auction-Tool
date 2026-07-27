import { describe, expect, it } from "vitest";
import {
  createLeagueConfig,
  LEAGUE_LIMITS,
} from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";

const standardStarters = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
};

const standardFlex = [{ count: 1, eligible: ["RB", "WR", "TE"] as const }];

describe("createLeagueConfig", () => {
  it.each([
    ["teams", { teams: 33 }, "Teams cannot exceed 32"],
    [
      "budget",
      { budget: 100_001 },
      "Budget cannot exceed $100,000",
    ],
    ["bench", { bench: 65 }, "Bench cannot exceed 64"],
  ])("rejects an unrealistic manual %s correction", (_field, patch, message) => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
        bench: 6,
        flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
        receptionPoints: 0.5,
        ...patch,
      }),
    ).toThrow(message);
  });

  it("rejects unrealistic slot, flex-group, and scoring corrections", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: { QB: 65, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
        bench: 0,
        flex: [],
        receptionPoints: 0,
      }),
    ).toThrow("QB starters cannot exceed 64");
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: { QB: 1, RB: 1, WR: 1, TE: 1, K: 0, DEF: 0 },
        bench: 0,
        flex: Array.from({ length: 17 }, () => ({
          count: 1,
          eligible: ["RB" as const],
        })),
        receptionPoints: 0,
      }),
    ).toThrow("Flex groups cannot exceed 16");
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: { QB: 1, RB: 1, WR: 1, TE: 1, K: 0, DEF: 0 },
        bench: 0,
        flex: [],
        receptionPoints: 101,
      }),
    ).toThrow("Reception points must be between -100 and 100");
  });

  it("normalizes a 12-team half-PPR auction league", () => {
    const league = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters: standardStarters,
      bench: 6,
      flex: standardFlex,
      receptionPoints: 0.5,
    });

    expect(league.rosterSize).toBe(15);
    expect(league.minBid).toBe(1);
    expect(league.scoring.reception).toBe(0.5);
    expect(league.flex).toEqual([{ count: 1, eligible: ["RB", "WR", "TE"] }]);
  });

  it("rejects budgets that cannot cover every roster slot", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 10,
        starters: standardStarters,
        bench: 6,
        flex: standardFlex,
        receptionPoints: 0.5,
      }),
    ).toThrow("Budget must cover every roster slot");
  });

  it("rejects negative roster counts", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: { ...standardStarters, RB: -1 },
        bench: 6,
        flex: standardFlex,
        receptionPoints: 0.5,
      }),
    ).toThrow();
  });

  it("rejects a fractional starter count", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: { ...standardStarters, WR: 2.5 },
        bench: 6,
        flex: standardFlex,
        receptionPoints: 0.5,
      }),
    ).toThrow("WR starters must be a non-negative integer");
  });

  it("rejects a fractional flex count", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: standardStarters,
        bench: 6,
        flex: [{ count: 1.5, eligible: ["RB", "WR"] }],
        receptionPoints: 0.5,
      }),
    ).toThrow("Flex slot 1 count must be a non-negative integer");
  });

  it("rejects empty or duplicate flex eligibility", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: standardStarters,
        bench: 6,
        flex: [{ count: 1, eligible: [] }],
        receptionPoints: 0.5,
      }),
    ).toThrow();
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: standardStarters,
        bench: 6,
        flex: [{ count: 1, eligible: ["RB", "RB"] }],
        receptionPoints: 0.5,
      }),
    ).toThrow();
  });

  it("validates the minimum-bid reserve", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 15,
        minBid: 2,
        starters: standardStarters,
        bench: 6,
        flex: standardFlex,
        receptionPoints: 0.5,
      }),
    ).toThrow("Budget must cover every roster slot");
  });

  it("rejects unsafe integer money inputs before downstream arithmetic", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        minBid: Number.MAX_SAFE_INTEGER + 1,
        starters: standardStarters,
        bench: 6,
        flex: standardFlex,
        receptionPoints: 0.5,
      }),
    ).toThrow("Minimum bid must be a positive integer");
  });

  it("enforces documented fantasy-auction money limits", () => {
    expect(LEAGUE_LIMITS).toMatchObject({
      budget: 100_000,
      minBid: 10_000,
    });
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 100_000,
        minBid: 10_001,
        starters: standardStarters,
        bench: 0,
        flex: [],
        receptionPoints: 0.5,
      }),
    ).toThrow("Minimum bid cannot exceed $10,000");
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        minBid: 201,
        starters: standardStarters,
        bench: 0,
        flex: [],
        receptionPoints: 0.5,
      }),
    ).toThrow("Minimum bid cannot exceed the auction budget");
  });

  it("merges scoring overrides with the default scoring rules", () => {
    const league = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters: standardStarters,
      bench: 6,
      flex: standardFlex,
      receptionPoints: 0.5,
      scoring: { passTd: 6, positionReceptionBonus: { TE: 0.5 } },
    });

    expect(league.scoring).toMatchObject({
      passYard: 0.04,
      passTd: 6,
      reception: 0.5,
      positionReceptionBonus: { TE: 0.5 },
    });
  });

  it.each([NaN, Infinity])("rejects non-finite reception points: %s", (receptionPoints) => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: standardStarters,
        bench: 6,
        flex: standardFlex,
        receptionPoints,
      }),
    ).toThrow("Reception points must be a finite number");
  });

  it.each([NaN, Infinity, "six"])(
    "rejects invalid supported scoring overrides: %s",
    (passTd) => {
      expect(() =>
        createLeagueConfig({
          teams: 12,
          budget: 200,
          starters: standardStarters,
          bench: 6,
          flex: standardFlex,
          receptionPoints: 0.5,
          scoring: { passTd } as never,
        }),
      ).toThrow("Scoring passTd must be a finite number");
    },
  );

  it("ignores undefined scoring overrides and retains defaults", () => {
    const league = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters: standardStarters,
      bench: 6,
      flex: standardFlex,
      receptionPoints: 0.5,
      scoring: { passTd: undefined },
    });

    expect(league.scoring.passTd).toBe(4);
  });

  it("does not let runtime scoring reception override reception points", () => {
    const league = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters: standardStarters,
      bench: 6,
      flex: standardFlex,
      receptionPoints: 0.5,
      scoring: { reception: 3 } as never,
    });

    expect(league.scoring.reception).toBe(0.5);
  });

  it("rejects non-finite position reception bonuses", () => {
    expect(() =>
      createLeagueConfig({
        teams: 12,
        budget: 200,
        starters: standardStarters,
        bench: 6,
        flex: standardFlex,
        receptionPoints: 0.5,
        scoring: { positionReceptionBonus: { TE: Infinity } },
      }),
    ).toThrow("Position reception bonus for TE must be a finite number");
  });

  it("returns fresh default objects for every league", () => {
    const first = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters: standardStarters,
      bench: 6,
      flex: standardFlex,
      receptionPoints: 0.5,
    });
    const second = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters: standardStarters,
      bench: 6,
      flex: standardFlex,
      receptionPoints: 0.5,
    });

    first.scoring.positionReceptionBonus.TE = 2;
    first.flex[0].eligible.push("QB");

    expect(second.scoring.positionReceptionBonus).toEqual({});
    expect(second.flex[0].eligible).toEqual(["RB", "WR", "TE"]);
  });

  it("isolates the normalized league from caller mutations", () => {
    const starters = { ...standardStarters };
    const flex: { count: number; eligible: Position[] }[] = [
      { count: 1, eligible: ["RB", "WR", "TE"] },
    ];
    const positionReceptionBonus = { TE: 0.5 };
    const league = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters,
      bench: 6,
      flex,
      receptionPoints: 0.5,
      scoring: { positionReceptionBonus },
    });

    starters.RB = 4;
    flex[0].eligible = ["QB"];
    positionReceptionBonus.TE = 2;

    expect(league.starters.RB).toBe(2);
    expect(league.flex[0].eligible).toEqual(["RB", "WR", "TE"]);
    expect(league.scoring.positionReceptionBonus).toEqual({ TE: 0.5 });
  });
});
