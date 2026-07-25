import type { TeamDraftState } from "../draft/types";
import type { LeagueConfig, Position } from "../league/types";
import type { StrategyConfig } from "../strategy/types";
import type { ReplacementLevels, ScoredPlayer } from "./replacement-levels";
import { allocateLargestRemainders } from "./round-money";

const SUPPORTED_POSITIONS: ReadonlyArray<Position> = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
];

export type BasePlayerValue = {
  playerId: string;
  position: Position;
  points: number;
  starterVorp: number;
  benchVorp: number;
  blendedVorp: number;
  baseValue: number;
  displayValue: number;
  replacementPlayerId?: string;
  inflationMultiplier: number;
};

export type CalculateBaseValuesInput = {
  league: LeagueConfig;
  strategy: StrategyConfig;
  players: ScoredPlayer[];
  teams: TeamDraftState[];
  replacementLevels: ReplacementLevels;
  preDraftDisplayValues?: ReadonlyMap<string, number>;
};

type CanonicalPlayer = {
  playerId: string;
  position: Position;
  points: number;
};

type ValuedPlayer = Omit<
  BasePlayerValue,
  "baseValue" | "displayValue" | "inflationMultiplier"
>;

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function firstSupportedPosition(
  positions: ReadonlyArray<Position>,
): Position | undefined {
  return positions.find((position) => SUPPORTED_POSITIONS.includes(position));
}

function validateTeams(teams: ReadonlyArray<TeamDraftState>): {
  openSlots: number;
  remainingBudget: number;
  draftedPlayerIds: Set<string>;
} {
  let openSlots = 0;
  let remainingBudget = 0;
  const draftedPlayerIds = new Set<string>();

  teams.forEach((team, index) => {
    if (!Number.isSafeInteger(team.openSlots) || team.openSlots < 0) {
      throw new Error(
        `Team ${index + 1} open slots must be a non-negative integer`,
      );
    }
    if (
      !Number.isSafeInteger(team.remainingBudget) ||
      team.remainingBudget < 0
    ) {
      throw new Error(
        `Team ${index + 1} remaining budget must be a non-negative integer`,
      );
    }
    if (!Array.isArray(team.playerIds)) {
      throw new Error(`Team ${index + 1} player IDs must be an array`);
    }

    openSlots += team.openSlots;
    remainingBudget += team.remainingBudget;
    team.playerIds.forEach((playerId) => draftedPlayerIds.add(playerId));
  });

  if (
    !Number.isSafeInteger(openSlots) ||
    !Number.isSafeInteger(remainingBudget)
  ) {
    throw new Error("Combined team state exceeds the supported integer range");
  }

  return { openSlots, remainingBudget, draftedPlayerIds };
}

function canonicalizePlayers(
  players: ReadonlyArray<ScoredPlayer>,
  draftedPlayerIds: ReadonlySet<string>,
): CanonicalPlayer[] {
  const byId = new Map<string, CanonicalPlayer>();

  players.forEach((player) => {
    if (
      typeof player.playerId !== "string" ||
      draftedPlayerIds.has(player.playerId) ||
      !Number.isFinite(player.points) ||
      !Array.isArray(player.positions)
    ) {
      return;
    }

    const position = firstSupportedPosition(player.positions);
    if (position === undefined) {
      return;
    }

    const current = byId.get(player.playerId);
    if (current === undefined || player.points > current.points) {
      byId.set(player.playerId, {
        playerId: player.playerId,
        position,
        points: player.points,
      });
    }
  });

  return [...byId.values()].sort((left, right) =>
    compareIds(left.playerId, right.playerId),
  );
}

function valuePlayers(
  players: ReadonlyArray<CanonicalPlayer>,
  replacementLevels: ReplacementLevels,
  starterBudgetShare: number,
): ValuedPlayer[] {
  return players.map((player) => {
    const starterVorp = Math.max(
      0,
      player.points - replacementLevels.starterPoints[player.position],
    );
    const benchVorp = Math.max(
      0,
      player.points - replacementLevels.benchPoints[player.position],
    );

    return {
      ...player,
      starterVorp,
      benchVorp,
      blendedVorp:
        starterVorp * starterBudgetShare + benchVorp * (1 - starterBudgetShare),
      replacementPlayerId:
        replacementLevels.replacementPlayerIds[player.position],
    };
  });
}

function isCapped(player: ValuedPlayer, league: LeagueConfig): boolean {
  return (
    league.capKickerDefenseAtOne &&
    (player.position === "K" || player.position === "DEF")
  );
}

export function calculateBaseValues({
  league,
  strategy,
  players,
  teams,
  replacementLevels,
  preDraftDisplayValues,
}: CalculateBaseValuesInput): Map<string, BasePlayerValue> {
  if (
    !Number.isFinite(strategy.starterBudgetShare) ||
    strategy.starterBudgetShare < 0 ||
    strategy.starterBudgetShare > 1
  ) {
    throw new Error("starterBudgetShare must be a finite number from 0 to 1");
  }
  if (!Number.isSafeInteger(league.minBid) || league.minBid <= 0) {
    throw new Error("League minimum bid must be a positive integer");
  }

  const { openSlots, remainingBudget, draftedPlayerIds } = validateTeams(teams);
  const minimumReserve = openSlots * league.minBid;
  if (
    !Number.isSafeInteger(minimumReserve) ||
    remainingBudget < minimumReserve
  ) {
    throw new Error("Remaining budget cannot cover the minimum-bid reserve");
  }

  const canonicalPlayers = canonicalizePlayers(players, draftedPlayerIds);
  if (canonicalPlayers.length < openSlots) {
    throw new Error("Remaining player pool cannot fill every open slot");
  }

  const valuedPlayers = valuePlayers(
    canonicalPlayers,
    replacementLevels,
    strategy.starterBudgetShare,
  );
  const draftablePlayers = [...valuedPlayers]
    .sort(
      (left, right) =>
        right.blendedVorp - left.blendedVorp ||
        right.points - left.points ||
        compareIds(left.playerId, right.playerId),
    )
    .slice(0, openSlots);
  const draftableIds = new Set(
    draftablePlayers.map((player) => player.playerId),
  );
  const uncappedPlayers = draftablePlayers.filter(
    (player) => !isCapped(player, league),
  );
  const extraPool = remainingBudget - minimumReserve;
  const positiveEligibleVorp = uncappedPlayers.reduce(
    (sum, player) => sum + player.blendedVorp,
    0,
  );

  if (extraPool > 0 && uncappedPlayers.length === 0) {
    throw new Error(
      "Extra dollars cannot be allocated because every player is capped",
    );
  }

  let fallbackPlayerId: string | undefined;
  if (extraPool > 0 && positiveEligibleVorp === 0) {
    fallbackPlayerId = [...uncappedPlayers].sort(
      (left, right) =>
        right.points - left.points || compareIds(left.playerId, right.playerId),
    )[0].playerId;
  }

  const baseValues = new Map<string, number>();
  valuedPlayers.forEach((player) => {
    if (!draftableIds.has(player.playerId)) {
      baseValues.set(player.playerId, 0);
      return;
    }

    let extra = 0;
    if (!isCapped(player, league)) {
      if (positiveEligibleVorp > 0 && player.blendedVorp > 0) {
        extra = (extraPool * player.blendedVorp) / positiveEligibleVorp;
      } else if (player.playerId === fallbackPlayerId) {
        extra = extraPool;
      }
    }
    baseValues.set(player.playerId, league.minBid + extra);
  });

  const roundedDraftableValues = allocateLargestRemainders(
    draftablePlayers.map((player) => {
      const baseValue = baseValues.get(player.playerId)!;
      const floor = Math.floor(baseValue);
      return {
        id: player.playerId,
        floor,
        remainder: baseValue - floor,
      };
    }),
    remainingBudget,
  );

  return new Map(
    valuedPlayers.map((player) => {
      const baseValue = baseValues.get(player.playerId)!;
      const displayValue = roundedDraftableValues.get(player.playerId) ?? 0;
      const preDraftValue = preDraftDisplayValues?.get(player.playerId);
      const rawInflation =
        preDraftValue !== undefined && preDraftValue > 0
          ? displayValue / preDraftValue
          : 1;
      const inflationMultiplier = Number.isFinite(rawInflation)
        ? rawInflation
        : 1;

      return [
        player.playerId,
        {
          ...player,
          baseValue,
          displayValue,
          inflationMultiplier,
        },
      ];
    }),
  );
}
