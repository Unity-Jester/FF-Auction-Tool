"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { LeagueConfig, Position } from "@/domain/league/types";
import type { PlayerPreference, StrategyConfig } from "@/domain/strategy/types";
import { loadSession, saveSession } from "@/persistence/session-storage";
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
  const router = useRouter();
  const [savedSession] = useState(() => loadSession(draftId));
  const [strategy, setStrategy] = useState(
    () => savedSession?.strategy ?? defaultStrategy(league),
  );
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
  const starterBudget = Math.round(league.budget * strategy.starterBudgetShare);
  const benchBudget = league.budget - starterBudget;
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
      ...savedSession,
      version: 1,
      draftId,
      strategy,
      preferences: {
        ...(savedSession?.preferences ?? {}),
        ...strategy.preferences,
      },
      localCorrections: savedSession?.localCorrections ?? [],
      csvProjectionOverrides: savedSession?.csvProjectionOverrides ?? [],
      savedAt: new Date().toISOString(),
    });
    router.push(`/draft/${draftId}`);
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
            onClick={() => setStrategy((current) => ({
              ...defaultStrategy(league, preset),
              preferences: current.preferences,
              projectionOverrides: current.projectionOverrides,
              valueOverrides: current.valueOverrides,
            }))}
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
          <div className="budget-list">
            <label>
              Starter budget
              <input
                aria-label="Starter budget"
                type="number"
                min="0"
                max={league.budget}
                value={starterBudget}
                onChange={(event) =>
                  setStrategy((current) => ({
                    ...current,
                    archetype: "custom",
                    starterBudgetShare: Math.max(
                      0,
                      Math.min(
                        1,
                        (Number(event.target.value) || 0) / league.budget,
                      ),
                    ),
                  }))
                }
              />
            </label>
            <label>
              Bench budget
              <input
                aria-label="Bench budget"
                type="number"
                min="0"
                max={league.budget}
                value={benchBudget}
                onChange={(event) =>
                  setStrategy((current) => ({
                    ...current,
                    archetype: "custom",
                    starterBudgetShare:
                      1 -
                      Math.max(
                        0,
                        Math.min(
                          league.budget,
                          Number(event.target.value) || 0,
                        ),
                      ) /
                        league.budget,
                  }))
                }
              />
            </label>
          </div>
          <p className="section-note">
            Starter + bench: ${starterBudget + benchBudget}
          </p>
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
          <div className="budget-list">
            {strategy.spendingCurve.map((weight, index) => (
              <label key={index}>
                Purchase {index + 1}
                <input
                  aria-label={`Purchase ${index + 1} curve`}
                  type="number"
                  min="0"
                  max="3"
                  step=".01"
                  value={weight}
                  onChange={(event) =>
                    setStrategy((current) => ({
                      ...current,
                      archetype: "custom",
                      spendingCurve: current.spendingCurve.map((entry, n) =>
                        n === index
                          ? Math.max(
                              0,
                              Math.min(3, Number(event.target.value) || 0),
                            )
                          : entry,
                      ),
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="budget-list">
            <label>
              QB approach
              <select
                aria-label="QB approach"
                value={strategy.qbApproach}
                onChange={(e) =>
                  setStrategy((c) => ({
                    ...c,
                    qbApproach: e.target.value as typeof c.qbApproach,
                    archetype: "custom",
                  }))
                }
              >
                <option value="auto">Auto</option>
                <option value="elite">Elite</option>
                <option value="value">Value</option>
              </select>
            </label>
            <label>
              TE approach
              <select
                aria-label="TE approach"
                value={strategy.teApproach}
                onChange={(e) =>
                  setStrategy((c) => ({
                    ...c,
                    teApproach: e.target.value as typeof c.teApproach,
                    archetype: "custom",
                  }))
                }
              >
                <option value="auto">Auto</option>
                <option value="elite">Elite</option>
                <option value="value">Value</option>
              </select>
            </label>
            <label>
              RB build
              <select
                aria-label="RB build"
                value={strategy.rbBuild}
                onChange={(e) =>
                  setStrategy((c) => ({
                    ...c,
                    rbBuild: e.target.value as typeof c.rbBuild,
                    archetype: "custom",
                  }))
                }
              >
                <option value="auto">Neutral</option>
                <option value="hero">Hero</option>
                <option value="zero">Zero</option>
              </select>
            </label>
          </div>
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
            {strategy.qbApproach} · TE {strategy.teApproach} · RB{" "}
            {strategy.rbBuild}
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
