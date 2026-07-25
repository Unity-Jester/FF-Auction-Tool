import { describe, expect, it } from "vitest";
import { scoreProjection } from "@/domain/valuation/score-projection";
import type { ProjectionStats } from "@/domain/players/types";
import type { ScoringRules } from "@/domain/league/types";

const standardScoring: ScoringRules = {
  passYard: 0.04,
  passTd: 4,
  interception: -2,
  rushYard: 0.1,
  rushTd: 6,
  reception: 0.5,
  receivingYard: 0.1,
  receivingTd: 6,
  fumbleLost: -2,
  positionReceptionBonus: {},
};

const stats: ProjectionStats = {
  passYards: 4000,
  passTds: 30,
  interceptions: 10,
  rushYards: 300,
  rushTds: 3,
  receptions: 80,
  receivingYards: 1000,
  receivingTds: 8,
  fumblesLost: 2,
};

describe("scoreProjection", () => {
  it("scores a half-PPR WR projection across every supported stat", () => {
    expect(scoreProjection(stats, standardScoring, "WR")).toBe(492);
  });

  it("scores a full-PPR WR projection", () => {
    expect(scoreProjection(stats, { ...standardScoring, reception: 1 }, "WR")).toBe(532);
  });

  it("adds TE premium to each reception for tight ends", () => {
    expect(
      scoreProjection(
        stats,
        { ...standardScoring, reception: 1, positionReceptionBonus: { TE: 0.5 } },
        "TE",
      ),
    ).toBe(572);
  });

  it("treats missing stat fields as zero", () => {
    expect(scoreProjection({}, standardScoring, "RB")).toBe(0);
  });

  it("rounds negative totals at one-decimal boundaries", () => {
    expect(scoreProjection({ interceptions: 1 }, { ...standardScoring, interception: -3.96 }, "QB")).toBe(
      -4,
    );
    expect(scoreProjection({ interceptions: 1 }, { ...standardScoring, interception: -3.94 }, "QB")).toBe(
      -3.9,
    );
  });

  it("normalizes a small negative score rounded to zero into positive zero", () => {
    const result = scoreProjection(
      { interceptions: 1 },
      { ...standardScoring, interception: -0.04 },
      "QB",
    );

    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("treats non-finite stat fields as zero", () => {
    expect(scoreProjection({ passYards: NaN, rushYards: Infinity }, standardScoring, "QB")).toBe(0);
  });

  it("applies a reception bonus only for the supplied position", () => {
    const scoring = {
      ...standardScoring,
      positionReceptionBonus: { WR: 0.5, TE: 1 },
    };
    const receptions = { receptions: 10 };

    expect(scoreProjection(receptions, scoring, "WR")).toBe(10);
    expect(scoreProjection(receptions, scoring, "TE")).toBe(15);
    expect(scoreProjection(receptions, scoring, "RB")).toBe(5);
  });
});
