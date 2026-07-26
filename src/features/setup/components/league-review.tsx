"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { LeagueConfig } from "@/domain/league/types";
import { createLeagueConfig } from "@/domain/league/defaults";

export function LeagueReview({
  draftId,
  league,
}: {
  draftId: string;
  league: LeagueConfig;
}) {
  const router = useRouter();
  const [teams, setTeams] = useState(String(league.teams));
  const [budget, setBudget] = useState(String(league.budget));
  const [minBid, setMinBid] = useState(String(league.minBid));
  const [bench, setBench] = useState(String(league.bench));
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    try {
      createLeagueConfig({
        teams: Number(teams),
        budget: Number(budget),
        minBid: Number(minBid),
        starters: league.starters,
        bench: Number(bench),
        flex: league.flex,
        receptionPoints: league.scoring.reception,
        scoring: league.scoring,
        capKickerDefenseAtOne: league.capKickerDefenseAtOne,
      });
      router.push(`/draft/${draftId}/strategy`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Check the imported league settings.",
      );
    }
  };
  const field = (
    label: string,
    value: string,
    setter: (value: string) => void,
  ) => (
    <label>
      {label}
      <span className="source">Sleeper import</span>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(event) => setter(event.target.value)}
      />
    </label>
  );
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
            {field("Teams", teams, setTeams)}
            {field("Auction budget", budget, setBudget)}
            {field("Minimum bid", minBid, setMinBid)}
            {field("Bench slots", bench, setBench)}
          </div>
        </section>
        <section>
          <h2>
            Roster & flex <span className="source">Sleeper import</span>
          </h2>
          <p>
            {Object.entries(league.starters)
              .filter(([, count]) => count > 0)
              .map(([position, count]) => `${count} ${position}`)
              .join(" · ")}{" "}
            ·{" "}
            {league.flex
              .map((slot) => `${slot.count} ${slot.eligible.join("/")} flex`)
              .join(" · ")}
          </p>
          <h2>
            Scoring <span className="source">Sleeper import</span>
          </h2>
          <p>
            {league.scoring.reception} PPR · {league.scoring.passTd} pass TD ·{" "}
            {league.scoring.rushTd} rush TD · K/DEF cap{" "}
            {league.capKickerDefenseAtOne ? "$1" : "off"}
          </p>
        </section>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer className="strategy-footer">
        <p>
          {league.rosterSize} slots imported · budget must cover every slot at
          the minimum bid.
        </p>
        <button className="primary" onClick={submit}>
          Set strategy
        </button>
      </footer>
    </section>
  );
}
