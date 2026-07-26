"use client";

import { useMemo, useState } from "react";

import type { LeagueConfig, Position } from "@/domain/league/types";
import type { PlayerPreference, StrategyConfig } from "@/domain/strategy/types";
import { saveSession } from "@/persistence/session-storage";
import { defaultStrategy } from "../default-strategies";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const presetLabels: Array<[StrategyConfig["archetype"], string]> = [
  ["recommended", "Recommended"],
  ["balanced", "Balanced"],
  ["stars-and-scrubs", "Stars and scrubs"],
  ["custom", "Custom"],
];

export function StrategyBuilder({
  draftId,
  league,
}: {
  draftId: string;
  league: LeagueConfig;
}) {
  const [strategy, setStrategy] = useState(() => defaultStrategy(league));
  const [player, setPlayer] = useState("");
  const [manualValue, setManualInput] = useState("");
  const total = useMemo(
    () =>
      Object.values(strategy.positionBudgets).reduce(
        (sum, value) => sum + value,
        0,
      ),
    [strategy],
  );
  const valid =
    total === league.budget &&
    strategy.minReserve >= league.rosterSize * league.minBid &&
    strategy.minReserve <= league.budget;
  const changeBudget = (position: Position, value: string) =>
    setStrategy((current) => ({
      ...current,
      archetype: "custom",
      positionBudgets: {
        ...current.positionBudgets,
        [position]: Math.max(0, Number(value) || 0),
      },
    }));
  const preference = (value: PlayerPreference) => {
    const name = player.trim();
    if (!name) return;
    setStrategy((current) => ({
      ...current,
      preferences: { ...current.preferences, [name]: value },
    }));
  };
  const applyManualValue = () => {
    const name = player.trim();
    const value = Number(manualValue);
    if (!name || !Number.isFinite(value) || value < 0) return;
    setStrategy((current) => ({
      ...current,
      valueOverrides: { ...current.valueOverrides, [name]: value },
    }));
  };
  const enter = () => {
    if (!valid) return;
    saveSession({
      version: 1,
      draftId,
      strategy,
      preferences: strategy.preferences,
      localCorrections: [],
      csvProjectionOverrides: [],
      savedAt: new Date().toISOString(),
    });
    window.history.replaceState(null, "", `/draft/${draftId}`);
  };
  return (
    <section className="strategy-layout" aria-labelledby="strategy-title">
      <header>
        <p className="kicker">03 / Strategy</p>
        <h1 id="strategy-title">Build your buying plan.</h1>
        <p>Set the spend, then let the draft room keep the math visible.</p>
      </header>
      <div className="preset-row" aria-label="Strategy presets">
        {presetLabels.map(([preset, label]) => (
          <button
            key={preset}
            className={strategy.archetype === preset ? "selected" : ""}
            onClick={() => setStrategy(defaultStrategy(league, preset))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="strategy-grid">
        <section className="control-section">
          <h2>Budget shape</h2>
          <p className="section-note">
            ${league.budget} available · ${strategy.minReserve} held for open
            slots
          </p>
          <div className="budget-list">
            {positions.map((position) => (
              <label key={position}>
                {position}
                <input
                  aria-label={`${position} budget`}
                  inputMode="numeric"
                  type="number"
                  min="0"
                  value={strategy.positionBudgets[position]}
                  onChange={(event) =>
                    changeBudget(position, event.target.value)
                  }
                />
              </label>
            ))}
          </div>
          <p className={total === league.budget ? "valid" : "error"}>
            {total === league.budget
              ? `Exact budget: $${total}`
              : `Position budgets must equal $${league.budget} (currently $${total}).`}
          </p>
          <label className="wide-label">
            Minimum reserve
            <input
              aria-label="Minimum reserve"
              type="number"
              min={league.rosterSize * league.minBid}
              value={strategy.minReserve}
              onChange={(event) =>
                setStrategy((current) => ({
                  ...current,
                  minReserve: Math.max(0, Number(event.target.value) || 0),
                }))
              }
            />
          </label>
        </section>
        <aside className="blueprint">
          <p className="kicker">Projected roster blueprint</p>
          <strong>
            {strategy.archetype === "stars-and-scrubs"
              ? "Aggressive early spending"
              : strategy.archetype === "balanced"
                ? "Even spending window"
                : "Flexible auction plan"}
          </strong>
          <ol>
            {strategy.spendingCurve.map((weight, index) => (
              <li key={index}>
                <span>Purchase {index + 1}</span>
                <b style={{ width: `${Math.min(100, weight * 60)}%` }} />
              </li>
            ))}
          </ol>
          <p>
            {Math.round(strategy.starterBudgetShare * 100)}% starter spend · QB{" "}
            {strategy.qbApproach} · RB {strategy.rbBuild}
          </p>
        </aside>
      </div>
      <section className="preferences">
        <h2>Player calls</h2>
        <div className="input-row">
          <input
            aria-label="Player preference"
            value={player}
            onChange={(event) => setPlayer(event.target.value)}
            placeholder="Player name"
          />
          <input
            aria-label="Manual value"
            inputMode="numeric"
            type="number"
            min="0"
            value={manualValue}
            onChange={(event) => setManualInput(event.target.value)}
            placeholder="$ value"
          />
          <button type="button" onClick={() => preference("target")}>
            Target player
          </button>
          <button type="button" onClick={() => preference("avoid")}>
            Avoid player
          </button>
          <button type="button" onClick={() => preference("lock")}>
            Lock player
          </button>
          <button type="button" onClick={applyManualValue}>
            Set manual value
          </button>
        </div>
        {Object.entries(strategy.preferences).map(([name, value]) => (
          <p key={name}>
            {name} · {value[0].toUpperCase() + value.slice(1)}
          </p>
        ))}
        {Object.entries(strategy.valueOverrides).map(([name, value]) => (
          <p key={`${name}-manual`}>
            {name} · Manual ${value}
          </p>
        ))}
      </section>
      <div className="strategy-footer">
        <p>
          {valid
            ? "Budget checks are clear."
            : `Reserve must cover ${league.rosterSize} minimum bids.`}
        </p>
        <button className="primary" disabled={!valid} onClick={enter}>
          Enter draft room
        </button>
      </div>
    </section>
  );
}
