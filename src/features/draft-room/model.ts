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
  maximumLegalBid: number | null;
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
  minBid: number;
  syncStatus: DraftSyncStatus;
  lastUpdatedAt: string | null;
  projectionStatus: "fresh" | "stale" | "empty";
  projectionLabel: string;
  selectedPlayerId: string | null;
  selectedRosterId: number;
  teams: DraftRoomTeam[];
  players: DraftRoomPlayer[];
  recentPurchase: {
    playerId: string;
    rosterId: number;
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
  ignoredCorrections: Array<{
    playerId: string;
    playerName: string;
    teamName: string;
    amount: number;
    reason: string;
  }>;
  dataWarnings: string[];
  emptyMessage: string | null;
  reviewSetupRequired?: boolean;
  configurationNotice?: string | null;
};

function maxLegal(team: Pick<TeamDraftState, "remainingBudget" | "openSlots">, minBid: number) {
  return team.openSlots <= 0
    ? 0
    : Math.max(0, team.remainingBudget - Math.max(0, team.openSlots - 1) * minBid);
}

function onePurchasePerPlayer(purchases: DraftPurchase[]): DraftPurchase[] {
  const byPlayer = new Map<string, DraftPurchase>();
  [...purchases]
    .sort((left, right) => left.pickNo - right.pickNo)
    .forEach((purchase) => byPlayer.set(purchase.playerId, purchase));
  return [...byPlayer.values()].sort((left, right) => left.pickNo - right.pickNo);
}

function effectivePurchases(
  snapshot: DraftSnapshot,
  corrections: DraftPurchase[],
): { purchases: DraftPurchase[]; active: DraftPurchase[]; ignored: DraftPurchase[] } {
  const authoritative = onePurchasePerPlayer(snapshot.purchases);
  const local = onePurchasePerPlayer(corrections);
  if (snapshot.status === "complete") {
    return { purchases: authoritative, active: [], ignored: local };
  }
  const byPlayer = new Map(authoritative.map((purchase) => [purchase.playerId, purchase]));
  local.forEach((purchase) => byPlayer.set(purchase.playerId, purchase));
  return {
    purchases: [...byPlayer.values()].sort((left, right) => left.pickNo - right.pickNo),
    active: local,
    ignored: [],
  };
}

function rebuildTeams(
  snapshotTeams: TeamDraftState[],
  league: LeagueConfig,
  purchases: DraftPurchase[],
): { teams: TeamDraftState[]; unownedPurchases: DraftPurchase[] } {
  const teams = snapshotTeams.map((team) => ({
    rosterId: team.rosterId,
    name: team.name,
    remainingBudget: league.budget,
    openSlots: league.rosterSize,
    playerIds: [] as string[],
  }));
  const byRoster = new Map(teams.map((team) => [team.rosterId, team]));
  const unownedPurchases: DraftPurchase[] = [];
  purchases.forEach((purchase) => {
    const team = byRoster.get(purchase.rosterId);
    if (!team) {
      unownedPurchases.push(purchase);
      return;
    }
    team.remainingBudget -= purchase.amount;
    team.openSlots -= 1;
    team.playerIds.push(purchase.playerId);
  });
  return { teams, unownedPurchases };
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
  const effective = effectivePurchases(input.snapshot, input.localCorrections);
  const rebuilt = rebuildTeams(input.snapshot.teams, input.league, effective.purchases);
  const teamCountMismatch = input.league.teams !== input.snapshot.teams.length;
  const ledgerMessage = teamCountMismatch
    ? `Values unavailable: saved setup has ${input.league.teams} teams, but the Sleeper draft has ${input.snapshot.teams.length}. Review setup before using bid guidance.`
    : rebuilt.unownedPurchases.length > 0
      ? "Values and maximum bids are unavailable because a purchase references an unknown roster. Review setup or reverse the quarantined local correction."
      : null;
  const scoredById = new Map(input.projections.flatMap((projection) => {
    const supported = positions.filter((position) => projection.positions.includes(position));
    if (supported.length === 0) return [];
    const overridden = strategy.projectionOverrides[projection.playerId];
    return [[projection.playerId, {
      playerId: projection.playerId,
      positions: supported,
      points: Number.isFinite(overridden)
        ? overridden
        : Math.max(...supported.map((position) =>
            scoreProjection(projection.stats, input.league.scoring, position))),
    }] as const];
  }));
  const unjoinable: DraftPurchase[] = [];
  effective.purchases.forEach((purchase) => {
    if (scoredById.has(purchase.playerId)) return;
    const player = metadata.get(purchase.playerId);
    const supported = positions.filter((position) => player?.positions.includes(position));
    if (supported.length === 0) {
      unjoinable.push(purchase);
      return;
    }
    scoredById.set(purchase.playerId, {
      playerId: purchase.playerId,
      positions: supported,
      points: 0,
    });
  });
  const scored = [...scoredById.values()];
  const draftedIds = new Set(rebuilt.teams.flatMap((team) => team.playerIds));
  const knownIds = new Set(scored.map((player) => player.playerId));
  const validRosterIds = new Set(rebuilt.teams.map((team) => team.rosterId));
  const valuationPurchases = effective.purchases.filter(
    (purchase) => knownIds.has(purchase.playerId) && validRosterIds.has(purchase.rosterId),
  );
  let values = new Map<string, PlayerValuation>();
  let valuationError: string | null = ledgerMessage;
  if (!ledgerMessage) {
    const replacementLevels = calculateReplacementLevels({
      league: input.league,
      players: scored,
      draftedPlayerIds: draftedIds,
    });
    try {
      values = runValuationEngine({
        league: input.league,
        strategy,
        players: scored,
        teams: rebuilt.teams,
        replacementLevels,
        myRosterId: input.myRosterId,
        purchases: valuationPurchases,
        auctionComplete: input.snapshot.status === "complete",
      });
    } catch (error) {
      valuationError = valuationFailureMessage(error);
    }
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
  const displayPurchases = ledgerMessage
    ? onePurchasePerPlayer(input.snapshot.purchases)
    : effective.purchases;
  const displayTeamStates = ledgerMessage ? input.snapshot.teams : rebuilt.teams;
  const purchaseByPlayer = new Map(
    displayPurchases.map((purchase) => [purchase.playerId, purchase]),
  );
  const teams: DraftRoomTeam[] = displayTeamStates.map((team) => ({
    rosterId: team.rosterId,
    name: team.name,
    remainingBudget: team.remainingBudget,
    openSlots: team.openSlots,
    maximumLegalBid: ledgerMessage ? null : maxLegal(team, input.league.minBid),
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
  const orderedPurchases = [...displayPurchases].sort(
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
    minBid: input.league.minBid,
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
      playerId: latest.playerId,
      rosterId: latest.rosterId,
      playerName: metadata.get(latest.playerId)?.name ?? projectionById.get(latest.playerId)?.name ?? `Unknown player ${latest.playerId}`,
      teamName: teams.find((team) => team.rosterId === latest.rosterId)?.name ?? `Roster ${latest.rosterId}`,
      amount: latest.amount,
      local: latest.source === "local",
    } : null,
    localCorrections: effective.active.map((purchase) => ({
      playerId: purchase.playerId,
      playerName: metadata.get(purchase.playerId)?.name ?? projectionById.get(purchase.playerId)?.name ?? `Unknown player ${purchase.playerId}`,
      teamName: teams.find((team) => team.rosterId === purchase.rosterId)?.name ?? `Roster ${purchase.rosterId}`,
      amount: purchase.amount,
    })),
    ignoredCorrections: effective.ignored.map((purchase) => ({
      playerId: purchase.playerId,
      playerName: metadata.get(purchase.playerId)?.name ?? projectionById.get(purchase.playerId)?.name ?? `Unknown player ${purchase.playerId}`,
      teamName: teams.find((team) => team.rosterId === purchase.rosterId)?.name ?? `Roster ${purchase.rosterId}`,
      amount: purchase.amount,
      reason: "Ignored because final Sleeper results are authoritative.",
    })),
    dataWarnings: [
      ...(unjoinable.length
        ? [`${unjoinable.length} purchase${unjoinable.length === 1 ? "" : "s"} could not be joined to player position data.`]
        : []),
      ...(rebuilt.unownedPurchases.length
        ? [`${rebuilt.unownedPurchases.length} purchase${rebuilt.unownedPurchases.length === 1 ? " was" : "s were"} quarantined because ${rebuilt.unownedPurchases.length === 1 ? "it" : "they"} referenced an unknown roster.`]
        : []),
    ],
    emptyMessage: valuationError ?? (input.projections.length === 0
      ? "No projections are available. Import a CSV in strategy setup or retry later."
      : available.length === 0
        ? "No available projected players remain."
        : null),
    reviewSetupRequired: ledgerMessage !== null,
  };
}
