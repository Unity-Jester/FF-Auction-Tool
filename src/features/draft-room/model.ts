import type { DraftPurchase, DraftSnapshot, TeamDraftState } from "@/domain/draft/types";
import type { LeagueConfig, Position } from "@/domain/league/types";
import type { PlayerProjection } from "@/domain/players/types";
import type { PlayerPreference, StrategyConfig } from "@/domain/strategy/types";
import { runValuationEngine, type PlayerValuation } from "@/domain/valuation/engine";
import { calculateReplacementLevels } from "@/domain/valuation/replacement-levels";
import { scoreProjection } from "@/domain/valuation/score-projection";
import type { DraftSyncStatus } from "@/features/draft-session/use-draft-sync";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export type PlayerSnapshot = {
  playerId: string;
  name: string;
  team: string | null;
  positions: Position[];
  status?: string | null;
  injuryStatus?: string | null;
};

export type DraftRoomPlayer = {
  id: string;
  name: string;
  team: string | null;
  position: Position;
  points: number;
  baseValue: number;
  adjustedValue: number;
  recommendedMaxBid: number;
  maximumLegalBid: number;
  preference: PlayerPreference;
  explanation: string;
  adjustments: Array<{ label: string; delta: number }>;
};

export type DraftRoomTeam = {
  rosterId: number;
  name: string;
  remainingBudget: number;
  openSlots: number;
  maximumLegalBid: number;
  players: Array<{
    id: string;
    name: string;
    position: Position | null;
    amount: number | null;
    local: boolean;
  }>;
};

export type DraftRoomViewModel = {
  draftId: string;
  draftStatus: DraftSnapshot["status"];
  syncStatus: DraftSyncStatus;
  lastUpdatedAt: string | null;
  projectionStatus: "fresh" | "stale" | "empty";
  projectionLabel: string;
  selectedPlayerId: string | null;
  selectedRosterId: number;
  teams: DraftRoomTeam[];
  players: DraftRoomPlayer[];
  recentPurchase: {
    playerName: string;
    teamName: string;
    amount: number;
    local: boolean;
  } | null;
  localCorrections: Array<{
    playerId: string;
    playerName: string;
    teamName: string;
    amount: number;
  }>;
  emptyMessage: string | null;
  configurationNotice?: string | null;
};

function maxLegal(team: Pick<TeamDraftState, "remainingBudget" | "openSlots">, minBid: number) {
  return team.openSlots <= 0
    ? 0
    : Math.max(0, team.remainingBudget - Math.max(0, team.openSlots - 1) * minBid);
}

function effectiveTeams(
  teams: TeamDraftState[],
  corrections: DraftPurchase[],
): TeamDraftState[] {
  return teams.map((team) => {
    const additions = corrections.filter(
      (purchase) =>
        purchase.rosterId === team.rosterId &&
        !team.playerIds.includes(purchase.playerId),
    );
    return additions.reduce<TeamDraftState>(
      (current, purchase) => ({
        ...current,
        remainingBudget: Math.max(0, current.remainingBudget - purchase.amount),
        openSlots: Math.max(0, current.openSlots - 1),
        playerIds: [...current.playerIds, purchase.playerId],
      }),
      team,
    );
  });
}

function valuationFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/remaining budget/i.test(message)) {
    return `Values unavailable: ${message}. Review the saved league setup and local corrections.`;
  }
  if (/purchase|roster owner|duplicate|unknown roster/i.test(message)) {
    return "Values unavailable: purchases conflict with roster assignments. Reverse local corrections or retry Sleeper sync.";
  }
  return "Values unavailable: the draft data could not be reconciled. Retry sync or review the saved league setup.";
}

function normalizedStrategy(
  strategy: StrategyConfig,
  players: ReadonlyMap<string, PlayerSnapshot>,
  preferences: Record<string, PlayerPreference>,
): StrategyConfig {
  const idByName = new Map(
    [...players.values()].map((player) => [player.name.toLocaleLowerCase(), player.playerId]),
  );
  const normalizeRecord = <T,>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        players.has(key) ? key : (idByName.get(key.toLocaleLowerCase()) ?? key),
        value,
      ]),
    );
  return {
    ...strategy,
    preferences: {
      ...normalizeRecord(strategy.preferences),
      ...normalizeRecord(preferences),
    },
    projectionOverrides: normalizeRecord(strategy.projectionOverrides),
    valueOverrides: normalizeRecord(strategy.valueOverrides),
  };
}

export function buildDraftRoomViewModel(input: {
  snapshot: DraftSnapshot;
  league: LeagueConfig;
  strategy: StrategyConfig;
  preferences: Record<string, PlayerPreference>;
  projections: PlayerProjection[];
  projectionSource: string;
  projectionStale: boolean;
  playerSnapshot: PlayerSnapshot[];
  myRosterId: number;
  localCorrections: DraftPurchase[];
  syncStatus: DraftSyncStatus;
  lastUpdatedAt: string | null;
  selectedPlayerId?: string | null;
}): DraftRoomViewModel {
  const metadata = new Map(input.playerSnapshot.map((player) => [player.playerId, player]));
  const projectionById = new Map(input.projections.map((projection) => [projection.playerId, projection]));
  const strategy = normalizedStrategy(input.strategy, metadata, input.preferences);
  const scored = input.projections.flatMap((projection) => {
    const supported = positions.filter((position) => projection.positions.includes(position));
    if (supported.length === 0) return [];
    const overridden = strategy.projectionOverrides[projection.playerId];
    return [{
      playerId: projection.playerId,
      positions: supported,
      points: Number.isFinite(overridden)
        ? overridden
        : Math.max(...supported.map((position) =>
            scoreProjection(projection.stats, input.league.scoring, position))),
    }];
  });
  const effective = effectiveTeams(input.snapshot.teams, input.localCorrections);
  const valuationTeams =
    input.snapshot.status === "complete" &&
    effective.every((team) => team.openSlots === 0 && team.remainingBudget >= 0)
      ? effective.map((team) => ({ ...team, remainingBudget: 0 }))
      : effective;
  const draftedIds = new Set(effective.flatMap((team) => team.playerIds));
  const knownIds = new Set(scored.map((player) => player.playerId));
  const purchases = [...input.snapshot.purchases, ...input.localCorrections].filter(
    (purchase) => knownIds.has(purchase.playerId),
  );
  const replacementLevels = calculateReplacementLevels({
    league: input.league,
    players: scored,
    draftedPlayerIds: draftedIds,
  });
  let values = new Map<string, PlayerValuation>();
  let valuationError: string | null = null;
  try {
    values = runValuationEngine({
      league: input.league,
      strategy,
      players: scored,
      teams: valuationTeams,
      replacementLevels,
      myRosterId: input.myRosterId,
      purchases,
    });
  } catch (error) {
    valuationError = valuationFailureMessage(error);
  }
  const available: DraftRoomPlayer[] = [...values.values()]
    .flatMap((value) => {
      const projection = projectionById.get(value.playerId);
      const player = metadata.get(value.playerId);
      if (!projection) return [];
      return [{
        id: value.playerId,
        name: player?.name ?? projection.name ?? `Unknown player ${value.playerId}`,
        team: player?.team ?? projection.team,
        position: value.position,
        points: value.points,
        baseValue: value.baseValue,
        adjustedValue: value.adjustedValue,
        recommendedMaxBid: value.recommendedMaxBid,
        maximumLegalBid: value.maximumLegalBid,
        preference: strategy.preferences[value.playerId] ?? "neutral",
        explanation: value.explanation,
        adjustments: value.adjustments.map(({ label, delta }) => ({ label, delta })),
      }];
    })
    .sort((a, b) =>
      b.recommendedMaxBid - a.recommendedMaxBid ||
      b.adjustedValue - a.adjustedValue ||
      a.name.localeCompare(b.name),
    );
  const purchaseByPlayer = new Map(
    [...input.snapshot.purchases, ...input.localCorrections].map((purchase) => [
      purchase.playerId,
      purchase,
    ]),
  );
  const teams: DraftRoomTeam[] = effective.map((team) => ({
    rosterId: team.rosterId,
    name: team.name,
    remainingBudget: team.remainingBudget,
    openSlots: team.openSlots,
    maximumLegalBid: maxLegal(team, input.league.minBid),
    players: team.playerIds.map((playerId) => {
      const player = metadata.get(playerId);
      const projection = projectionById.get(playerId);
      const purchase = purchaseByPlayer.get(playerId);
      return {
        id: playerId,
        name: player?.name ?? projection?.name ?? `Unknown player ${playerId}`,
        position: player?.positions[0] ?? projection?.positions[0] ?? null,
        amount: purchase?.amount ?? null,
        local: purchase?.source === "local",
      };
    }),
  }));
  const orderedPurchases = [...input.snapshot.purchases, ...input.localCorrections].sort(
    (a, b) => b.pickNo - a.pickNo,
  );
  const latest = orderedPurchases[0];
  const selectedPlayerId =
    input.selectedPlayerId && available.some((player) => player.id === input.selectedPlayerId)
      ? input.selectedPlayerId
      : available[0]?.id ?? null;
  return {
    draftId: input.snapshot.draftId,
    draftStatus: input.snapshot.status,
    syncStatus: input.syncStatus,
    lastUpdatedAt: input.lastUpdatedAt,
    projectionStatus:
      input.projections.length === 0 ? "empty" : input.projectionStale ? "stale" : "fresh",
    projectionLabel: input.projectionSource,
    selectedPlayerId,
    selectedRosterId: input.myRosterId,
    teams,
    players: available,
    recentPurchase: latest ? {
      playerName: metadata.get(latest.playerId)?.name ?? projectionById.get(latest.playerId)?.name ?? `Unknown player ${latest.playerId}`,
      teamName: teams.find((team) => team.rosterId === latest.rosterId)?.name ?? `Roster ${latest.rosterId}`,
      amount: latest.amount,
      local: latest.source === "local",
    } : null,
    localCorrections: input.localCorrections.map((purchase) => ({
      playerId: purchase.playerId,
      playerName: metadata.get(purchase.playerId)?.name ?? projectionById.get(purchase.playerId)?.name ?? `Unknown player ${purchase.playerId}`,
      teamName: teams.find((team) => team.rosterId === purchase.rosterId)?.name ?? `Roster ${purchase.rosterId}`,
      amount: purchase.amount,
    })),
    emptyMessage: valuationError ?? (input.projections.length === 0
      ? "No projections are available. Import a CSV in strategy setup or retry later."
      : available.length === 0
        ? "No available projected players remain."
        : null),
  };
}
