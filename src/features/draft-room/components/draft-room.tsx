"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";
import { defaultStrategy } from "@/features/strategy/default-strategies";
import { reconcileDraft } from "@/features/draft-session/reconcile";
import { useDraftSync } from "@/features/draft-session/use-draft-sync";
import { resolveLeagueConfig } from "@/persistence/league-storage";
import { loadSession, saveSession, type StoredSessionV1 } from "@/persistence/session-storage";
import type { ProjectionSnapshot } from "@/integrations/projections/types";
import { buildDraftRoomViewModel, type DraftRoomViewModel, type PlayerSnapshot } from "../model";
import styles from "../draft-room.module.css";
import { CurrentPlayer } from "./current-player";
import { LeagueRosters } from "./league-rosters";
import { MyRoster } from "./my-roster";
import { PlayerBoard } from "./player-board";
import { SyncStatus } from "./sync-status";

type Tab = "now" | "players" | "team" | "league";
const tabs: Array<[Tab, string]> = [
  ["now", "Now"], ["players", "Players"], ["team", "My team"], ["league", "League"],
];
const rosterKey = (draftId: string) => `sleeper-auction-companion:roster:${draftId}`;
const mobileQuery = "(max-width: 767px)";

function subscribeMobile(callback: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function useMobileLayout() {
  return useSyncExternalStore(
    subscribeMobile,
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(mobileQuery).matches),
    () => false,
  );
}

export function DraftRoomView({
  model,
  onRetry,
  onSelectPlayer,
  onReverseCorrection,
  onAddCorrection,
  onChangeRoster,
}: {
  model: DraftRoomViewModel;
  onRetry: () => void;
  onSelectPlayer?: (playerId: string) => void;
  onReverseCorrection?: (playerId: string) => void;
  onAddCorrection?: (playerId: string, rosterId: number, amount: number) => void;
  onChangeRoster?: () => void;
}) {
  const [selectedPlayerId, setSelectedPlayerId] = useState(model.selectedPlayerId);
  const [tab, setTab] = useState<Tab>("now");
  const [correctionPlayerId, setCorrectionPlayerId] = useState<string | null>(null);
  const [correctionTeam, setCorrectionTeam] = useState(String(model.selectedRosterId));
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const isMobile = useMobileLayout();
  const effectiveSelectedPlayerId = model.players.some((player) => player.id === selectedPlayerId)
    ? selectedPlayerId
    : model.selectedPlayerId;
  const select = useCallback((playerId: string) => {
    setSelectedPlayerId(playerId);
    onSelectPlayer?.(playerId);
  }, [onSelectPlayer]);
  const selected = model.players.find((player) => player.id === effectiveSelectedPlayerId) ?? null;
  const show = (target: Tab) => tab === target ? styles.mobileActive : "";
  const existingPurchase = model.teams
    .flatMap((team) => team.players.map((player) => ({ team, player })))
    .find(({ player }) => player.id === correctionPlayerId);
  const openCorrection = useCallback((playerId: string) => {
    const existing = model.teams
      .flatMap((team) => team.players.map((player) => ({ team, player })))
      .find(({ player }) => player.id === playerId);
    setCorrectionPlayerId(playerId);
    setCorrectionTeam(String(existing?.team.rosterId ?? model.selectedRosterId));
    setCorrectionAmount(existing?.player.amount === null || existing?.player.amount === undefined
      ? ""
      : String(existing.player.amount));
    setCorrectionError(null);
    setTab("now");
  }, [model.selectedRosterId, model.teams]);
  const closeCorrection = () => {
    setCorrectionPlayerId(null);
    setCorrectionAmount("");
    setCorrectionError(null);
  };
  const selectedCorrectionTeam = model.teams.find(
    (team) => team.rosterId === Number(correctionTeam),
  );
  const consumesNewSlot =
    !existingPurchase ||
    existingPurchase.team.rosterId !== selectedCorrectionTeam?.rosterId;
  const correctionCapacityError =
    consumesNewSlot && selectedCorrectionTeam && selectedCorrectionTeam.openSlots <= 0
      ? `${selectedCorrectionTeam.name} has no open roster slots for this purchase.`
      : null;
  const correctionMaximum = selectedCorrectionTeam
    ? correctionCapacityError
      ? 0
      : existingPurchase?.team.rosterId === selectedCorrectionTeam.rosterId
      ? selectedCorrectionTeam.remainingBudget +
        (existingPurchase.player.amount ?? 0) -
        Math.max(0, selectedCorrectionTeam.openSlots) * model.minBid
      : selectedCorrectionTeam.remainingBudget -
        Math.max(0, selectedCorrectionTeam.openSlots - 1) * model.minBid
    : 0;
  const activateTab = (next: Tab) => {
    setTab(next);
    document.getElementById(`draft-tab-${next}`)?.focus();
  };
  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const index = tabs.findIndex(([id]) => id === current);
    let next: Tab | null = null;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length][0];
    if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length][0];
    if (event.key === "Home") next = tabs[0][0];
    if (event.key === "End") next = tabs[tabs.length - 1][0];
    if (next) {
      event.preventDefault();
      activateTab(next);
    }
  };
  const panel = (target: Tab, className: string, content: React.ReactNode, aside = false) => {
    if (isMobile && tab !== target) return null;
    const Component = aside ? "aside" : "div";
    return (
      <Component
        id={`draft-panel-${target}`}
        role="tabpanel"
        aria-labelledby={`draft-tab-${target}`}
        className={`${className} ${show(target)}`}
      >
        {content}
      </Component>
    );
  };
  return (
    <div className={styles.room}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span aria-hidden="true">AC</span>
          <div><strong>Auction Companion</strong><small>Draft {model.draftId}</small></div>
        </div>
        <div className={styles.topMeta}>
          <span className={styles.draftState}>{model.draftStatus === "complete" ? "Draft complete" : model.draftStatus === "pre" ? "Pre-draft" : "Live draft"}</span>
          {onChangeRoster && <button className={styles.changeRoster} type="button" onClick={onChangeRoster}>Change roster</button>}
          <SyncStatus status={model.syncStatus} lastUpdatedAt={model.lastUpdatedAt} onRetry={onRetry} />
        </div>
      </header>
      {model.projectionStatus !== "fresh" && (
        <p className={styles.notice} role="status">
          {model.projectionStatus === "empty" ? "Projection data is unavailable." : "Using stale projection data."} {model.projectionLabel}
        </p>
      )}
      {model.configurationNotice && (
        <p className={styles.notice} role="status">{model.configurationNotice}</p>
      )}
      {model.dataWarnings.map((warning) => (
        <p key={warning} className={styles.notice} role="status">{warning}</p>
      ))}
      <nav className={styles.mobileTabs} role="tablist" aria-label="Draft room sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            id={`draft-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`draft-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => handleTabKey(event, id)}
          >{label}</button>
        ))}
      </nav>
      {model.draftStatus === "complete" && (
        <p className={styles.complete}>Final Sleeper results are loaded. Values are preserved for review.</p>
      )}
      <div className={styles.workspace}>
        {panel("now", styles.nowRegion, <>
          <CurrentPlayer
            player={selected}
            recentPurchase={model.recentPurchase}
            onEditRecentPurchase={onAddCorrection && model.draftStatus !== "complete" ? openCorrection : undefined}
          />
          {selected && onAddCorrection && model.draftStatus !== "complete" && correctionPlayerId === null && (
            <div className={styles.correctionControl}>
              <button className={styles.criticalAction} type="button" onClick={() => openCorrection(selected.id)}>
                Add local purchase correction
              </button>
            </div>
          )}
          {correctionPlayerId && onAddCorrection && model.draftStatus !== "complete" && (
            <div className={styles.correctionControl}>
              <button className={styles.criticalAction} type="button" onClick={closeCorrection}>Cancel correction</button>
              <form noValidate onSubmit={(event) => {
                event.preventDefault();
                const amount = Number(correctionAmount);
                if (correctionCapacityError) {
                  setCorrectionError(correctionCapacityError);
                } else if (!Number.isSafeInteger(amount)) {
                  setCorrectionError("Enter a whole-dollar sale price.");
                } else if (amount < model.minBid) {
                  setCorrectionError(`The minimum bid is $${model.minBid}.`);
                } else if (amount > correctionMaximum) {
                  setCorrectionError(`The maximum legal price is $${Math.max(0, correctionMaximum)}.`);
                } else {
                  onAddCorrection(correctionPlayerId, Number(correctionTeam), amount);
                  closeCorrection();
                }
              }}>
                <label>Assign to
                  <select aria-label="Assign to" value={correctionTeam} onChange={(event) => {
                    setCorrectionTeam(event.target.value);
                    setCorrectionError(null);
                  }}>
                    {model.teams.map((team) => <option key={team.rosterId} value={team.rosterId}>{team.name}</option>)}
                  </select>
                </label>
                <label>Sale price
                  <input aria-label="Local sale price" type="number" min={model.minBid} required value={correctionAmount} onChange={(event) => {
                    setCorrectionAmount(event.target.value);
                    setCorrectionError(null);
                  }} />
                </label>
                <button className={styles.criticalAction} type="submit">Save local correction</button>
              </form>
              {(correctionCapacityError || correctionError) && (
                <p className={styles.correctionError} role="alert">
                  {correctionCapacityError ?? correctionError}
                </p>
              )}
            </div>
          )}
        </>)}
        {panel("players", styles.playersRegion,
          model.emptyMessage ? (
            <div className={styles.emptyState}>
              <p>{model.emptyMessage}</p>
              {model.reviewSetupRequired && (
                <Link href={`/draft/${model.draftId}/setup`}>Review setup</Link>
              )}
            </div>
          ) : (
            <PlayerBoard players={model.players} selectedPlayerId={effectiveSelectedPlayerId} onSelectPlayer={select} />
          )
        )}
        {panel("team", styles.teamRegion,
          <MyRoster model={model} onReverseCorrection={onReverseCorrection} onEditPurchase={onAddCorrection ? openCorrection : undefined} />,
          true,
        )}
        {panel("league", styles.leagueRegion,
          <LeagueRosters model={model} onEditPurchase={onAddCorrection ? openCorrection : undefined} />,
          true,
        )}
      </div>
    </div>
  );
}

async function fetchAssets<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Unable to load draft resources");
  return response.json() as Promise<T>;
}

function RosterSelector({
  snapshot,
  onSelect,
}: {
  snapshot: DraftSnapshot;
  onSelect: (rosterId: number) => void;
}) {
  return (
    <section className={styles.selector} aria-labelledby="roster-selector-title">
      <p className={styles.eyebrow}>One safe choice</p>
      <h1 id="roster-selector-title">Which roster is yours?</h1>
      <p>Sleeper does not always include enough ownership information to identify you. Choose once; this stays on this device.</p>
      <div>
        {snapshot.teams.map((team) => (
          <button key={team.rosterId} type="button" onClick={() => onSelect(team.rosterId)}>
            <span>{team.name}</span>
            <small>${team.remainingBudget} · {team.openSlots} open slots</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function DraftRoom({ draftId }: { draftId: string }) {
  const sync = useDraftSync(draftId);
  const projections = useQuery({
    queryKey: ["projections"],
    queryFn: () => fetchAssets<ProjectionSnapshot>("/api/projections"),
  });
  const players = useQuery({
    queryKey: ["player-snapshot"],
    queryFn: async () => (await fetchAssets<{ players: PlayerSnapshot[] }>("/api/sleeper/players")).players,
  });
  const [session, setSession] = useState<StoredSessionV1 | null>(() => loadSession(draftId));
  const [rosterId, setRosterId] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(rosterKey(draftId)));
      return Number.isSafeInteger(saved) && saved > 0 ? saved : null;
    } catch { return null; }
  });
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const reconciled = useMemo(() => {
    if (!sync.data) return null;
    return reconcileDraft(
      { snapshot: sync.data, localCorrections: session?.localCorrections ?? [] },
      sync.data,
    );
  }, [session?.localCorrections, sync.data]);
  useEffect(() => {
    if (!session || !reconciled || reconciled.localCorrections === session.localCorrections) return;
    const next = { ...session, localCorrections: reconciled.localCorrections, savedAt: new Date().toISOString() };
    saveSession(next);
    const update = window.setTimeout(() => setSession(next), 0);
    return () => window.clearTimeout(update);
  }, [reconciled, session]);
  const validRoster = rosterId !== null && sync.data?.teams.some((team) => team.rosterId === rosterId);
  const valuationModel = useMemo(() => {
    if (!reconciled || !validRoster || !rosterId || !projections.data || !players.data) return null;
    const league = resolveLeagueConfig(draftId, reconciled.snapshot.league);
    const activeSession = session ?? {
      version: 1 as const,
      draftId,
      strategy: defaultStrategy(league),
      preferences: {},
      localCorrections: [],
      csvProjectionOverrides: [],
      savedAt: new Date().toISOString(),
    };
    const projectionMap = new Map(projections.data.projections.map((item) => [item.playerId, item]));
    activeSession.csvProjectionOverrides.forEach((item) => projectionMap.set(item.playerId, item));
    return buildDraftRoomViewModel({
      snapshot: reconciled.snapshot,
      league,
      strategy: activeSession.strategy,
      preferences: activeSession.preferences,
      projections: [...projectionMap.values()],
      projectionSource: activeSession.csvProjectionOverrides.length ? `${projections.data.source} + CSV overrides` : projections.data.source,
      projectionStale: projections.data.stale,
      playerSnapshot: players.data,
      myRosterId: rosterId,
      localCorrections: reconciled.localCorrections,
      syncStatus: "fresh",
      lastUpdatedAt: null,
    });
  }, [draftId, players.data, projections.data, reconciled, rosterId, session, validRoster]);
  const model = useMemo(() => valuationModel ? {
    ...valuationModel,
    syncStatus: sync.syncStatus,
    lastUpdatedAt: sync.lastUpdatedAt,
    configurationNotice: session
      ? null
      : "Using a recommended plan because no valid saved strategy was found.",
    selectedPlayerId:
      selectedPlayerId &&
      valuationModel.players.some((player) => player.id === selectedPlayerId)
        ? selectedPlayerId
        : valuationModel.selectedPlayerId,
  } : null, [selectedPlayerId, session, sync.lastUpdatedAt, sync.syncStatus, valuationModel]);
  if (!sync.data && sync.syncStatus === "offline") {
    return <section className={styles.blocking}><h1>Draft is unavailable.</h1><p>{sync.error instanceof Error ? sync.error.message : "No saved snapshot is available yet."}</p><button type="button" onClick={() => sync.retry()}>Retry sync</button></section>;
  }
  if (!sync.data || projections.isLoading || players.isLoading) {
    return <section className={styles.blocking} aria-live="polite"><span className={styles.loader} /><h1>Loading draft room</h1><p>Syncing Sleeper, projections, and your saved plan.</p></section>;
  }
  if (projections.isError || players.isError) {
    return <section className={styles.blocking}><h1>Draft resources unavailable.</h1><p>Your draft is safe. Retry the supporting data.</p><button type="button" onClick={() => { projections.refetch(); players.refetch(); }}>Retry resources</button></section>;
  }
  if (!validRoster) {
    return <RosterSelector snapshot={sync.data} onSelect={(id) => {
      try { localStorage.setItem(rosterKey(draftId), String(id)); } catch {}
      setRosterId(id);
    }} />;
  }
  if (!model) return null;
  const persistCorrections = (localCorrections: DraftPurchase[]) => {
    const league = resolveLeagueConfig(draftId, sync.data!.league);
    const active = session ?? {
      version: 1 as const, draftId, strategy: defaultStrategy(league), preferences: {},
      localCorrections: [], csvProjectionOverrides: [], savedAt: new Date().toISOString(),
    };
    const next = { ...active, localCorrections, savedAt: new Date().toISOString() };
    saveSession(next);
    setSession(next);
  };
  return <DraftRoomView
    model={model}
    onRetry={() => sync.retry()}
    onSelectPlayer={setSelectedPlayerId}
    onChangeRoster={() => {
      try { localStorage.removeItem(rosterKey(draftId)); } catch {}
      setRosterId(null);
    }}
    onReverseCorrection={(playerId) => persistCorrections((session?.localCorrections ?? []).filter((purchase) => purchase.playerId !== playerId))}
    onAddCorrection={(playerId, owner, amount) => {
      const existing = session?.localCorrections ?? [];
      const existingPurchase = existing.find((purchase) => purchase.playerId === playerId) ??
        sync.data!.purchases.find((purchase) => purchase.playerId === playerId);
      const nextPick = existingPurchase?.pickNo ??
        Math.max(0, ...sync.data!.purchases.map((purchase) => purchase.pickNo), ...existing.map((purchase) => purchase.pickNo)) + 1;
      persistCorrections([...existing.filter((purchase) => purchase.playerId !== playerId), {
        draftId, playerId, rosterId: owner, amount, pickNo: nextPick,
        createdAt: new Date().toISOString(), source: "local", keeper: existingPurchase?.keeper ?? false,
      }]);
    }}
  />;
}
