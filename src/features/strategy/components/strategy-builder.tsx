"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { LeagueConfig, Position } from "@/domain/league/types";
import type {
  PlayerProjection,
  ProjectionStats,
} from "@/domain/players/types";
import type { PlayerPreference, StrategyConfig } from "@/domain/strategy/types";
import { parseProjectionCsv } from "@/integrations/projections/csv-provider";
import {
  CSV_MATCH_LIMIT_ERROR,
  MAX_CSV_FILE_BYTES,
} from "@/integrations/projections/csv-limits";
import type {
  CsvProjectionResult,
  ProjectionPlayer,
} from "@/integrations/projections/types";
import { parsePublicAccountConfig } from "@/integrations/supabase/config";
import {
  BrowserStrategyRepository,
  browserStrategyStorage,
} from "@/persistence/browser-strategy-repository";
import type {
  SavedStrategy,
  SavedStrategyRepository,
} from "@/persistence/saved-strategy-repository";
import { loadSession, saveSession } from "@/persistence/session-storage";
import { defaultStrategy } from "../default-strategies";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const presetLabels: Array<[StrategyConfig["archetype"], string]> = [
  ["recommended", "Recommended"],
  ["balanced", "Balanced"],
  ["stars-and-scrubs", "Stars and scrubs"],
  ["custom", "Custom"],
];
const projectionStats = [
  ["Pass yards", "passYards"],
  ["Pass touchdowns", "passTds"],
  ["Interceptions", "interceptions"],
  ["Rush yards", "rushYards"],
  ["Rush touchdowns", "rushTds"],
  ["Receptions", "receptions"],
  ["Receiving yards", "receivingYards"],
  ["Receiving touchdowns", "receivingTds"],
  ["Fumbles lost", "fumblesLost"],
] as const satisfies ReadonlyArray<[string, keyof ProjectionStats]>;
const individualProjectionSource = "Individual projection override";

export function StrategyBuilder({
  draftId,
  league,
  players = [],
  projections = [],
}: {
  draftId: string;
  league: LeagueConfig;
  players?: readonly ProjectionPlayer[];
  projections?: readonly PlayerProjection[];
}) {
  const router = useRouter();
  const [savedSession] = useState(() => loadSession(draftId));
  const [strategy, setStrategy] = useState(
    () => savedSession?.strategy ?? defaultStrategy(league),
  );
  const [playerId, setPlayerId] = useState(() => players[0]?.playerId ?? "");
  const [manualValue, setManualInput] = useState("");
  const [projectionStat, setProjectionStat] =
    useState<keyof ProjectionStats>("rushYards");
  const [projectionStatValue, setProjectionStatValue] = useState("");
  const [projectionError, setProjectionError] = useState("");
  const [savedName, setSavedName] = useState("");
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedCreatedAt, setSavedCreatedAt] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [csvProjectionOverrides, setCsvProjectionOverrides] = useState(
    () => savedSession?.csvProjectionOverrides ?? [],
  );
  const [csvResult, setCsvResult] = useState<CsvProjectionResult | null>(null);
  const [csvError, setCsvError] = useState("");
  const [csvPending, setCsvPending] = useState(false);
  const [mutationPending, setMutationPending] = useState<{
    type: "save" | "remove";
    id?: string;
  } | null>(null);
  const accountEpoch = useRef(0);
  const accountAccessEnabled = useRef(false);
  const config = useMemo(
    () =>
      parsePublicAccountConfig({
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        captchaSiteKey: process.env.NEXT_PUBLIC_SUPABASE_CAPTCHA_SITE_KEY,
      }),
    [],
  );

  const getRepository = async (
    allowAccount = accountAccessEnabled.current,
  ): Promise<SavedStrategyRepository> => {
    const storage = browserStrategyStorage();
    if (!allowAccount) {
      return new BrowserStrategyRepository(storage);
    }
    const { repositoryForCurrentSession } = await import(
      "@/persistence/strategy-repository-selector"
    );
    return repositoryForCurrentSession(config ?? {}, storage);
  };

  const refreshSaved = async (
    allowAccount = accountAccessEnabled.current,
  ) => {
    const epoch = accountEpoch.current;
    try {
      const repository = await getRepository(allowAccount);
      const records = await repository.list();
      if (epoch !== accountEpoch.current) return;
      setSavedStrategies(records);
      setSaveError(repository.getWarnings?.()[0] ?? "");
    } catch {
      if (epoch !== accountEpoch.current) return;
      setSavedStrategies([]);
      setMutationPending(null);
      setSaveError("Saved strategies are unavailable. Your current plan is unchanged.");
    }
  };

  useEffect(() => {
    const initialRefresh = window.setTimeout(
      () => void refreshSaved(false),
      0,
    );
    const onAuthChange = () => {
      window.clearTimeout(initialRefresh);
      accountAccessEnabled.current = true;
      accountEpoch.current += 1;
      setSavedId(null);
      setSavedCreatedAt(null);
      setSavedName("");
      setSavedStrategies([]);
      setMutationPending(null);
      setSaveMessage("");
      setSaveError("");
      void refreshSaved(true);
    };
    window.addEventListener("strategy-auth-change", onAuthChange);
    return () => {
      accountEpoch.current += 1;
      window.clearTimeout(initialRefresh);
      window.removeEventListener("strategy-auth-change", onAuthChange);
    };
    // Configuration is fixed for the lifetime of the built client page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    if (!playerId) return;
    setStrategy((current) => ({
      ...current,
      preferences:
        value === "neutral"
          ? Object.fromEntries(
              Object.entries(current.preferences).filter(
                ([key]) => key !== playerId,
              ),
            )
          : { ...current.preferences, [playerId]: value },
    }));
  };
  const applyManualValue = () => {
    const value = Number(manualValue);
    if (!playerId || !Number.isFinite(value) || value < 0) return;
    setStrategy((current) => ({
      ...current,
      valueOverrides: { ...current.valueOverrides, [playerId]: value },
    }));
  };
  const applyProjectionStat = () => {
    const player = players.find((candidate) => candidate.playerId === playerId);
    const value = Number(projectionStatValue);
    if (
      !player ||
      !projectionStats.some(([, key]) => key === projectionStat) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100_000
    ) {
      setProjectionError(
        "Choose a player and enter a projection from 0 to 100,000.",
      );
      return;
    }
    const existing = csvProjectionOverrides.find(
      (projection) =>
        projection.playerId === playerId &&
        projection.source === individualProjectionSource,
    );
    const baseline = projections.find(
      (projection) => projection.playerId === playerId,
    );
    const next: PlayerProjection = {
      playerId: player.playerId,
      name: player.name,
      team: player.team,
      positions: [...player.positions],
      stats: {
        ...(baseline?.stats ?? {}),
        ...(existing?.stats ?? {}),
        [projectionStat]: value,
      },
      source: individualProjectionSource,
      updatedAt: new Date().toISOString(),
    };
    setCsvProjectionOverrides((current) => [
      ...current.filter(
        (projection) =>
          !(
            projection.playerId === playerId &&
            projection.source === individualProjectionSource
          ),
      ),
      next,
    ]);
    setProjectionError("");
    setProjectionStatValue("");
  };
  const clearIndividualProjection = () => {
    if (!playerId) return;
    setCsvProjectionOverrides((current) =>
      current.filter(
        (projection) =>
          !(
            projection.playerId === playerId &&
            projection.source === individualProjectionSource
          ),
      ),
    );
    setProjectionError("");
  };
  const selectedPlayer = players.find(
    (candidate) => candidate.playerId === playerId,
  );
  const playerLabel = (id: string) => {
    const player = players.find((candidate) => candidate.playerId === id);
    return player
      ? `${player.name} · ${player.team ?? "FA"} · ${player.positions.join("/")}`
      : id;
  };
  const saveNamedStrategy = async () => {
    if (mutationPending) return;
    const epoch = accountEpoch.current;
    const name = savedName.trim();
    if (!name || name.length > 80) {
      setSaveError("Strategy name must be between 1 and 80 characters.");
      return;
    }
    const now = new Date().toISOString();
    const record: SavedStrategy = {
      id: savedId ?? crypto.randomUUID(),
      name,
      strategy,
      createdAt: savedCreatedAt ?? now,
      updatedAt: now,
    };
    setMutationPending({ type: "save" });
    try {
      const repository = await getRepository();
      await repository.save(record);
      const records = await repository.list();
      if (epoch !== accountEpoch.current) return;
      setSavedId(record.id);
      setSavedCreatedAt(record.createdAt);
      setSaveMessage(`Saved “${name}”.`);
      setSaveError(repository.getWarnings?.()[0] ?? "");
      setSavedStrategies(records);
    } catch (error) {
      if (epoch !== accountEpoch.current) return;
      setSaveMessage("");
      setSaveError(
        error instanceof Error &&
          error.message === "You can save up to 50 named strategies."
          ? error.message
          : "The strategy could not be saved. Your current plan is unchanged.",
      );
    } finally {
      if (epoch === accountEpoch.current) setMutationPending(null);
    }
  };
  const loadNamedStrategy = (record: SavedStrategy) => {
    setStrategy(record.strategy);
    setSavedId(record.id);
    setSavedCreatedAt(record.createdAt);
    setSavedName(record.name);
    setSaveMessage(`Loaded “${record.name}”. Enter the draft room to use it.`);
    setSaveError("");
  };
  const removeNamedStrategy = async (record: SavedStrategy) => {
    if (mutationPending) return;
    const epoch = accountEpoch.current;
    setMutationPending({ type: "remove", id: record.id });
    try {
      const repository = await getRepository();
      await repository.remove(record.id);
      const records = await repository.list();
      if (epoch !== accountEpoch.current) return;
      if (savedId === record.id) {
        setSavedId(null);
        setSavedCreatedAt(null);
      }
      setSavedStrategies(records);
      setSaveMessage(`Removed “${record.name}”.`);
      setSaveError(repository.getWarnings?.()[0] ?? "");
    } catch {
      if (epoch !== accountEpoch.current) return;
      setSaveError("The saved strategy could not be removed.");
    } finally {
      if (epoch === accountEpoch.current) setMutationPending(null);
    }
  };
  const enter = () => {
    if (!valid) return;
    const saved = saveSession({
      ...savedSession,
      version: 1,
      draftId,
      strategy,
      preferences: {
        ...(savedSession?.preferences ?? {}),
        ...strategy.preferences,
      },
      localCorrections: savedSession?.localCorrections ?? [],
      csvProjectionOverrides,
      savedAt: new Date().toISOString(),
    });
    if (!saved.ok) {
      setSaveError("This browser could not save your draft plan. Check storage access, then try again.");
      return;
    }
    router.push(`/draft/${draftId}`);
  };
  const importProjectionCsv = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvPending(true);
    setCsvError("");
    setCsvResult(null);
    if (file.size > MAX_CSV_FILE_BYTES) {
      setCsvProjectionOverrides((current) =>
        current.filter(
          (projection) => projection.source === individualProjectionSource,
        ),
      );
      setCsvError(
        "The CSV exceeds the 1 MB file limit. Choose a smaller file.",
      );
      setCsvPending(false);
      event.target.value = "";
      return;
    }
    try {
      let projectionPlayers = players;
      if (projectionPlayers.length === 0) {
        const response = await fetch("/api/sleeper/players");
        if (!response.ok) throw new Error("players");
        const payload = (await response.json()) as {
          players?: ProjectionPlayer[];
        };
        if (!Array.isArray(payload.players)) throw new Error("players");
        projectionPlayers = payload.players;
      }
      const result = parseProjectionCsv(await file.text(), projectionPlayers);
      setCsvResult(result);
      const overMatchLimit = result.unsupported.some(
        (row) => row.reason === CSV_MATCH_LIMIT_ERROR,
      );
      setCsvProjectionOverrides((current) => [
        ...current.filter(
          (projection) => projection.source === individualProjectionSource,
        ),
        ...(overMatchLimit ? [] : result.matched),
      ]);
      if (overMatchLimit) setCsvError(CSV_MATCH_LIMIT_ERROR);
    } catch {
      setCsvProjectionOverrides((current) =>
        current.filter(
          (projection) => projection.source === individualProjectionSource,
        ),
      );
      setCsvError(
        "The CSV could not be imported. Check the file and try again.",
      );
    } finally {
      setCsvPending(false);
      event.target.value = "";
    }
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
        <p className="section-note">
          Player calls use Sleeper player IDs. Manual dollar values change auction
          value only; individual projections change supported projected stats.
        </p>
        <div className="input-row">
          <label>
            Player
            <select
              aria-label="Player"
              value={playerId}
              onChange={(event) => {
                setPlayerId(event.target.value);
                setProjectionError("");
              }}
            >
              {players.length === 0 && (
                <option value="">Player identities unavailable</option>
              )}
              {[...players]
                .sort(
                  (left, right) =>
                    left.name.localeCompare(right.name) ||
                    left.playerId.localeCompare(right.playerId),
                )
                .map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {player.name} · {player.team ?? "FA"} ·{" "}
                    {player.positions.join("/")} · {player.playerId}
                  </option>
                ))}
            </select>
          </label>
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
          <button type="button" onClick={() => preference("neutral")}>
            Clear player call
          </button>
          <button type="button" onClick={applyManualValue}>
            Set manual value
          </button>
        </div>
        <div className="input-row">
          <label>
            Projection statistic
            <select
              aria-label="Projection statistic"
              value={projectionStat}
              onChange={(event) =>
                setProjectionStat(
                  event.target.value as keyof ProjectionStats,
                )
              }
            >
              {projectionStats.map(([label, key]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Projection stat value
            <input
              aria-label="Projection stat value"
              type="number"
              min="0"
              max="100000"
              value={projectionStatValue}
              onChange={(event) => setProjectionStatValue(event.target.value)}
            />
          </label>
          <button type="button" onClick={applyProjectionStat}>
            Set projection stat
          </button>
          <button
            type="button"
            disabled={!csvProjectionOverrides.some(
              (projection) =>
                projection.playerId === playerId &&
                projection.source === individualProjectionSource,
            )}
            onClick={clearIndividualProjection}
          >
            Clear individual projection
          </button>
        </div>
        {projectionError && <p role="alert">{projectionError}</p>}
        {Object.entries(strategy.preferences).map(([id, value]) => (
          <p key={id}>
            {playerLabel(id)} · {value[0].toUpperCase() + value.slice(1)}
          </p>
        ))}
        {Object.entries(strategy.valueOverrides).map(([id, value]) => (
          <p key={`${id}-manual`}>
            {playerLabel(id)} · Manual dollar value · ${value}
          </p>
        ))}
        {csvProjectionOverrides
          .filter(
            (projection) =>
              projection.source === individualProjectionSource &&
              (!selectedPlayer || projection.playerId === selectedPlayer.playerId),
          )
          .map((projection) => (
            <p key={`${projection.playerId}-projection`}>
              {playerLabel(projection.playerId)} · Individual projection ·{" "}
              {Object.entries(projection.stats)
                .map(([key, value]) => {
                  const label =
                    projectionStats.find(([, field]) => field === key)?.[0] ??
                    key;
                  return `${label} ${Number(value).toLocaleString("en-US")}`;
                })
                .join(" · ")}
            </p>
          ))}
      </section>
      <section className="projection-import" aria-labelledby="projection-import-title">
        <div>
          <p className="kicker">Optional projections</p>
          <h2 id="projection-import-title">Projection CSV</h2>
          <p className="section-note">
            Match by player_id, or by name, team, and position. Supported stat
            columns are pass_yd, pass_td, pass_int, rush_yd, rush_td, rec,
            rec_yd, rec_td, and fum_lost.
          </p>
        </div>
        <label>
          Projection CSV
          <input
            aria-label="Projection CSV"
            type="file"
            accept=".csv,text/csv"
            disabled={csvPending}
            onChange={(event) => void importProjectionCsv(event)}
          />
        </label>
        {csvPending ? <p role="status">Checking projection matches…</p> : null}
        {csvError ? <p role="alert">{csvError}</p> : null}
        {csvResult ? (
          <div className="csv-report" role="status">
            <strong>{csvResult.matched.length} matched</strong>
            <span>{csvResult.unmatched.length} unmatched</span>
            <span>{csvResult.ambiguous.length} ambiguous</span>
            <span>{csvResult.duplicates.length} duplicate</span>
            <span>{csvResult.unsupported.length} unsupported</span>
            {[...csvResult.unmatched, ...csvResult.ambiguous].length ? (
              <details>
                <summary>Review rows needing attention</summary>
                <ul>
                  {[...csvResult.unmatched, ...csvResult.ambiguous].map(
                    (row, index) => (
                      <li key={`${row.sourceName}-${index}`}>
                        {row.sourceName || "Unnamed row"} — {row.reason}
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
          </div>
        ) : csvProjectionOverrides.filter(
            (projection) => projection.source !== individualProjectionSource,
          ).length ? (
          <p role="status">
            {
              csvProjectionOverrides.filter(
                (projection) =>
                  projection.source !== individualProjectionSource,
              ).length
            }{" "}
            saved CSV overrides will be used.
          </p>
        ) : null}
      </section>
      <section className="saved-strategies" aria-labelledby="saved-strategies-title">
        <div>
          <p className="kicker">Optional saving</p>
          <h2 id="saved-strategies-title">Named strategies</h2>
          <p className="section-note">
            Saved in this browser, or synced to your account when signed in.
          </p>
        </div>
        <div className="saved-strategy-controls">
          <label>
            Saved strategy name
            <input
              aria-label="Saved strategy name"
              maxLength={80}
              disabled={mutationPending !== null}
              value={savedName}
              onChange={(event) => setSavedName(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={mutationPending !== null}
            onClick={saveNamedStrategy}
          >
            {mutationPending?.type === "save" ? "Saving…" : "Save named strategy"}
          </button>
        </div>
        {savedStrategies.length ? (
          <ul className="saved-strategy-list">
            {savedStrategies.map((record) => (
              <li key={record.id}>
                <span>{record.name}</span>
                <button
                  type="button"
                  aria-label={`Load ${record.name}`}
                  disabled={mutationPending !== null}
                  onClick={() => loadNamedStrategy(record)}
                >
                  Load
                </button>
                <button
                  type="button"
                  aria-label={
                    mutationPending?.type === "remove" &&
                    mutationPending.id === record.id
                      ? `Removing ${record.name}`
                      : `Remove ${record.name}`
                  }
                  disabled={mutationPending !== null}
                  onClick={() => void removeNamedStrategy(record)}
                >
                  {mutationPending?.type === "remove" &&
                  mutationPending.id === record.id
                    ? "Removing…"
                    : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="section-note">No named strategies saved here yet.</p>
        )}
        {saveMessage ? <p role="status">{saveMessage}</p> : null}
        {saveError ? <p role="alert">{saveError}</p> : null}
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
