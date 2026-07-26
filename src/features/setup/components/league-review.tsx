"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { LeagueConfig, Position } from "@/domain/league/types";
import { saveLeagueConfig } from "@/persistence/league-storage";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const scoringFields = [
  ["Reception points", "reception"],
  ["Pass yard", "passYard"],
  ["Pass touchdown", "passTd"],
  ["Interception", "interception"],
  ["Rush yard", "rushYard"],
  ["Rush touchdown", "rushTd"],
  ["Receiving yard", "receivingYard"],
  ["Receiving touchdown", "receivingTd"],
  ["Fumble lost", "fumbleLost"],
] as const;

export function LeagueReview({
  draftId,
  league,
  importedLeague = league,
}: {
  draftId: string;
  league: LeagueConfig;
  importedLeague?: LeagueConfig;
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => ({
    teams: String(league.teams),
    budget: String(league.budget),
    minBid: String(league.minBid),
    bench: String(league.bench),
    starters: Object.fromEntries(
      positions.map((p) => [p, String(league.starters[p])]),
    ),
    flex: league.flex.map((f) => ({
      count: String(f.count),
      eligible: f.eligible.join(","),
    })),
    scoring: Object.fromEntries(
      scoringFields.map(([, key]) => [key, String(league.scoring[key])]),
    ),
    positionReceptionBonus: Object.fromEntries(
      (["RB", "WR", "TE"] as const).map((position) => [
        position,
        String(league.scoring.positionReceptionBonus[position] ?? 0),
      ]),
    ),
    cap: league.capKickerDefenseAtOne,
  }));
  const [error, setError] = useState<string | null>(null);
  const field = (
    label: string,
    value: string,
    change: (value: string) => void,
  ) => (
    <label>
      {label}
      <span className="source">Sleeper import</span>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(event) => change(event.target.value)}
      />
    </label>
  );
  const submit = () => {
    try {
      const next = createLeagueConfig({
        teams: Number(values.teams),
        budget: Number(values.budget),
        minBid: Number(values.minBid),
        bench: Number(values.bench),
        starters: Object.fromEntries(
          positions.map((p) => [p, Number(values.starters[p])]),
        ) as LeagueConfig["starters"],
        flex: values.flex.map((f) => ({
          count: Number(f.count),
          eligible: f.eligible
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean) as Position[],
        })),
        receptionPoints: Number(values.scoring.reception),
        scoring: {
          ...Object.fromEntries(
            scoringFields
              .filter(([, key]) => key !== "reception")
              .map(([, key]) => [key, Number(values.scoring[key])]),
          ),
          positionReceptionBonus: Object.fromEntries(
            (["RB", "WR", "TE"] as const).map((position) => [
              position,
              Number(values.positionReceptionBonus[position]),
            ]),
          ),
        },
        capKickerDefenseAtOne: values.cap,
      });
      saveLeagueConfig(draftId, next, importedLeague);
      router.push(`/draft/${draftId}/strategy`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Check the imported settings.",
      );
    }
  };
  return (
    <section className="review" aria-labelledby="review-title">
      <header>
        <p className="kicker">02 / League review</p>
        <h1 id="review-title">Confirm the room.</h1>
        <p>
          Every imported value is editable here. Changes stay on this device and
          never alter Sleeper.
        </p>
      </header>
      <div className="review-grid">
        <section>
          <h2>League basics</h2>
          <div className="field-grid">
            {field("Teams", values.teams, (v) =>
              setValues((s) => ({ ...s, teams: v })),
            )}
            {field("Auction budget", values.budget, (v) =>
              setValues((s) => ({ ...s, budget: v })),
            )}
            {field("Minimum bid", values.minBid, (v) =>
              setValues((s) => ({ ...s, minBid: v })),
            )}
            {field("Bench slots", values.bench, (v) =>
              setValues((s) => ({ ...s, bench: v })),
            )}
          </div>
          <h2>Starter slots</h2>
          <div className="field-grid">
            {positions.map((p) => (
              <span key={p}>
                {field(`${p} starters`, values.starters[p], (v) =>
                  setValues((s) => ({
                    ...s,
                    starters: { ...s.starters, [p]: v },
                  })),
                )}
              </span>
            ))}
          </div>
        </section>
        <section>
          <h2>Flex slots</h2>
          {values.flex.map((flex, index) => (
            <div className="field-grid" key={index}>
              {field(`Flex ${index + 1} slots`, flex.count, (v) =>
                setValues((s) => ({
                  ...s,
                  flex: s.flex.map((item, i) =>
                    i === index ? { ...item, count: v } : item,
                  ),
                })),
              )}
              {field(`Flex ${index + 1} eligibility`, flex.eligible, (v) =>
                setValues((s) => ({
                  ...s,
                  flex: s.flex.map((item, i) =>
                    i === index ? { ...item, eligible: v } : item,
                  ),
                })),
              )}
            </div>
          ))}
          <h2>Scoring</h2>
          <div className="field-grid">
            {scoringFields.map(([label, key]) => (
              <span key={key}>
                {field(label, values.scoring[key], (v) =>
                  setValues((s) => ({
                    ...s,
                    scoring: { ...s.scoring, [key]: v },
                  })),
                )}
              </span>
            ))}
            {(["RB", "WR", "TE"] as const).map((position) => (
              <span key={`${position}-bonus`}>
                {field(
                  `${position} reception bonus`,
                  values.positionReceptionBonus[position],
                  (v) =>
                    setValues((s) => ({
                      ...s,
                      positionReceptionBonus: {
                        ...s.positionReceptionBonus,
                        [position]: v,
                      },
                    })),
                )}
              </span>
            ))}
          </div>
          <label className="cap-toggle">
            <input
              aria-label="K/DEF at $1"
              type="checkbox"
              checked={values.cap}
              onChange={(event) =>
                setValues((s) => ({ ...s, cap: event.target.checked }))
              }
            />{" "}
            K/DEF at $1 <i className="source">Sleeper import</i>
          </label>
        </section>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer className="strategy-footer">
        <p>Roster size updates with every corrected slot.</p>
        <button className="primary" onClick={submit}>
          Set strategy
        </button>
      </footer>
    </section>
  );
}
