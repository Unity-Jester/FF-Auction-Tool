import type { DraftPurchase, DraftSnapshot, TeamDraftState } from "@/domain/draft/types";
import type { LeagueConfig, Position } from "@/domain/league/types";
import type { PlayerProjection } from "@/domain/players/types";
import type { PlayerPreference, StrategyConfig } from "@/domain/strategy/types";
import { calculateBaseValues } from "@/domain/valuation/base-values";
import {
  runValuationEngineWithMetadata,
  type PlayerValuation,
  type ValuationMetadata,
} from "@/domain/valuation/engine";
import type { ValueTier } from "@/domain/valuation/adjust-values";
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
  strategyMaximumBid?: number;
  inflationMultiplier?: number;
  bestFitPositions?: Position[];
  tier?: ValueTier | null;
  tierSupply?: number;
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
    unknownCost?: boolean;
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
    authoritativeTeamName: string | null;
    authoritativeAmount: number | null;
    reason: string;
  }>;
  dataWarnings: string[];
  emptyMessage: string | null;
  reviewSetupRequired?: boolean;
  configurationNotice?: string | null;
  inflation?: {
    league: number;
    byPosition: Record<Position, number>;
  };
  guidance: {
    bestFits: Array<{
      playerId: string;
      playerName: string;
      position: Position;
      fits: Position[];
      tier: ValueTier | null;
      tierSupply: number;
      recommendedMaxBid: number;
    }>;
    rosterNeeds: ValuationMetadata["rosterNeeds"];
    blueprint: Array<{
      position: Position;
      filled: number;
      open: number;
      spent: number;
      budget: number;
    }>;
    budgetPace: ValuationMetadata["budgetPace"];
    inflation: {
      league: number;
      position: Record<Position, number>;
    };
  };
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
  const byPlayer = new Map(authoritative.map((purchase) => [purchase.playerId, purchase]));
  const active: DraftPurchase[] = [];
  const ignored: DraftPurchase[] = [];
  local.forEach((purchase) => {
    if (byPlayer.has(purchase.playerId) || snapshot.status === "complete") {
      ignored.push(purchase);
      return;
    }
    byPlayer.set(purchase.playerId, purchase);
    active.push(purchase);
  });
  return {
    purchases: [...byPlayer.values()].sort((left, right) => left.pickNo - right.pickNo),
    active,
    ignored,
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
    playerIds: [...(team.unknownCostPlayerIds ?? [])],
    unknownCostPlayerIds: [...(team.unknownCostPlayerIds ?? [])],
  }));
  teams.forEach((team) => {
    team.openSlots = Math.max(0, league.rosterSize - team.playerIds.length);
  });
  const byRoster = new Map(teams.map((team) => [team.rosterId, team]));
  const unownedPurchases: DraftPurchase[] = [];
  purchases.forEach((purchase) => {
    const team = byRoster.get(purchase.rosterId);
    if (!team) {
      unownedPurchases.push(purchase);
      return;
    }
    team.remainingBudget -= purchase.amount;
    if (!team.playerIds.includes(purchase.playerId)) {
      team.openSlots -= 1;
      team.playerIds.push(purchase.playerId);
    }
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
  const normalizeRecord = <T,>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => players.has(key)),
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
  const snapshotRosterIds = new Set(
    input.snapshot.teams.map((team) => team.rosterId),
  );
  const invalidLocalCorrections = input.localCorrections.filter(
    (purchase) => !snapshotRosterIds.has(purchase.rosterId),
  );
  const effective = effectivePurchases(input.snapshot, input.localCorrections);
  const rebuilt = rebuildTeams(input.snapshot.teams, input.league, effective.purchases);
  const teamCountMismatch = input.league.teams !== input.snapshot.teams.length;
  const ledgerMessage = teamCountMismatch
    ? `Values unavailable: saved setup has ${input.league.teams} teams, but the Sleeper draft has ${input.snapshot.teams.length}. Review setup before using bid guidance.`
    : rebuilt.unownedPurchases.length > 0 || invalidLocalCorrections.length > 0
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
  const baselineScored = [...scoredById.values()];
  const unjoinable: DraftPurchase[] = [];
  rebuilt.teams.flatMap((team) => team.playerIds).forEach((playerId) => {
    if (scoredById.has(playerId)) return;
    const player = metadata.get(playerId);
    const supported = positions.filter((position) => player?.positions.includes(position));
    if (supported.length === 0) {
      const purchase = effective.purchases.find(
        (candidate) => candidate.playerId === playerId,
      );
      if (purchase) unjoinable.push(purchase);
      return;
    }
    scoredById.set(playerId, {
      playerId,
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
  let valuationMetadata: ValuationMetadata | null = null;
  let baselineDisplayValues = new Map<string, number>();
  let valuationError: string | null = ledgerMessage;
  if (!ledgerMessage) {
    const replacementLevels = calculateReplacementLevels({
      league: input.league,
      players: scored,
      draftedPlayerIds: draftedIds,
      rosteredPlayerIdsByTeam: rebuilt.teams.map((team) => team.playerIds),
    });
    try {
      const preDraftReplacementLevels = calculateReplacementLevels({
        league: input.league,
        players: baselineScored,
      });
      const preDraftTeams = rebuilt.teams.map((team) => ({
        ...team,
        remainingBudget: input.league.budget,
        openSlots: input.league.rosterSize,
        playerIds: [],
        unknownCostPlayerIds: [],
      }));
      baselineDisplayValues = new Map(
        [...calculateBaseValues({
          league: input.league,
          strategy,
          players: baselineScored,
          teams: preDraftTeams,
          replacementLevels: preDraftReplacementLevels,
        }).entries()].map(([playerId, value]) => [playerId, value.displayValue]),
      );
      const valuation = runValuationEngineWithMetadata({
        league: input.league,
        strategy,
        players: scored,
        teams: rebuilt.teams,
        replacementLevels,
        myRosterId: input.myRosterId,
        purchases: valuationPurchases,
        auctionComplete: input.snapshot.status === "complete",
        preDraftDisplayValues: baselineDisplayValues,
      });
      values = valuation.values;
      valuationMetadata = valuation.metadata;
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
        strategyMaximumBid: value.strategyMaximumBid,
        inflationMultiplier: value.inflationMultiplier,
        bestFitPositions:
          valuationMetadata?.bestFitPositionsByPlayerId[value.playerId] ?? [],
        tier: valuationMetadata?.tierByPlayerId[value.playerId] ?? null,
        tierSupply:
          valuationMetadata?.remainingSupplyAtOrAboveTierByPlayerId[
            value.playerId
          ] ?? 0,
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
        unknownCost: team.unknownCostPlayerIds?.includes(playerId) ?? false,
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
  const unknownCostCount = rebuilt.teams.reduce(
    (sum, team) => sum + (team.unknownCostPlayerIds?.length ?? 0),
    0,
  );
  const inflationFor = (position?: Position) => {
    const candidates = [...values.values()].filter(
      (value) =>
        value.displayValue > 0 &&
        (position === undefined || value.position === position),
    );
    const baseline = candidates.reduce(
      (sum, value) => sum + (baselineDisplayValues.get(value.playerId) ?? 0),
      0,
    );
    const live = candidates.reduce((sum, value) => sum + value.displayValue, 0);
    return baseline > 0 ? live / baseline : 1;
  };
  const leagueInflation = inflationFor();
  const positionInflation = Object.fromEntries(
    positions.map((position) => [position, inflationFor(position)]),
  ) as Record<Position, number>;
  const emptyRosterNeeds: ValuationMetadata["rosterNeeds"] = {
    fixed: Object.fromEntries(
      positions.map((position) => [position, 0]),
    ) as Record<Position, number>,
    flex: [],
    bench: 0,
  };
  const fallbackBudgetPace: ValuationMetadata["budgetPace"] = {
    remainingBudget:
      teams.find((team) => team.rosterId === input.myRosterId)
        ?.remainingBudget ?? 0,
    hardLegalMaximum:
      teams.find((team) => team.rosterId === input.myRosterId)
        ?.maximumLegalBid ?? 0,
    strategyMaximum:
      teams.find((team) => team.rosterId === input.myRosterId)
        ?.maximumLegalBid ?? 0,
    configuredExtraReserve: 0,
  };
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
    ignoredCorrections: effective.ignored.map((purchase) => {
      const authoritative = input.snapshot.purchases.find(
        (candidate) => candidate.playerId === purchase.playerId,
      );
      return {
        playerId: purchase.playerId,
        playerName: metadata.get(purchase.playerId)?.name ?? projectionById.get(purchase.playerId)?.name ?? `Unknown player ${purchase.playerId}`,
        teamName: teams.find((team) => team.rosterId === purchase.rosterId)?.name ?? `Roster ${purchase.rosterId}`,
        amount: purchase.amount,
        authoritativeTeamName: authoritative
          ? teams.find((team) => team.rosterId === authoritative.rosterId)?.name ??
            `Roster ${authoritative.rosterId}`
          : null,
        authoritativeAmount: authoritative?.amount ?? null,
        reason: authoritative
          ? "Sleeper now has an authoritative purchase; the differing local correction is visible but does not change values."
          : "Ignored because final Sleeper results are authoritative.",
      };
    }),
    dataWarnings: [
      ...(unjoinable.length
        ? [`${unjoinable.length} purchase${unjoinable.length === 1 ? "" : "s"} could not be joined to player position data.`]
        : []),
      ...((rebuilt.unownedPurchases.length + invalidLocalCorrections.length)
        ? [`${rebuilt.unownedPurchases.length + invalidLocalCorrections.length} purchase${rebuilt.unownedPurchases.length + invalidLocalCorrections.length === 1 ? " was" : "s were"} quarantined because ${rebuilt.unownedPurchases.length + invalidLocalCorrections.length === 1 ? "it" : "they"} referenced an unknown roster.`]
        : []),
      ...(unknownCostCount > 0
        ? [`${unknownCostCount} roster-held player${unknownCostCount === 1 ? " has" : "s have"} authoritative ownership but no reliable auction price; roster occupancy is counted without guessing spend.`]
        : []),
    ],
    emptyMessage: valuationError ?? (input.projections.length === 0
      ? "No projections are available. Import a CSV in strategy setup or retry later."
      : available.length === 0
        ? "No available projected players remain."
        : null),
    reviewSetupRequired: ledgerMessage !== null,
    inflation: {
      league: leagueInflation,
      byPosition: positionInflation,
    },
    guidance: {
      bestFits: available
        .filter((player) => (player.bestFitPositions?.length ?? 0) > 0)
        .slice(0, 3)
        .map((player) => ({
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          fits: player.bestFitPositions ?? [],
          tier: player.tier ?? null,
          tierSupply: player.tierSupply ?? 0,
          recommendedMaxBid: player.recommendedMaxBid,
        })),
      rosterNeeds: valuationMetadata?.rosterNeeds ?? emptyRosterNeeds,
      blueprint: positions.map((position) => ({
        position,
        filled: valuationMetadata?.blueprintProgress.filledByPosition[position] ?? 0,
        open: valuationMetadata?.blueprintProgress.openByPosition[position] ?? 0,
        spent: valuationMetadata?.blueprintProgress.spendByPosition[position] ?? 0,
        budget: valuationMetadata?.blueprintProgress.budgetByPosition[position] ??
          input.strategy.positionBudgets[position],
      })),
      budgetPace: valuationMetadata?.budgetPace ?? fallbackBudgetPace,
      inflation: {
        league: leagueInflation,
        position: positionInflation,
      },
    },
  };
}
