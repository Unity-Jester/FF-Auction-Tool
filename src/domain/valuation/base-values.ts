import type { TeamDraftState } from "../draft/types";
import type { LeagueConfig, Position } from "../league/types";
import type { StrategyConfig } from "../strategy/types";
import type { ReplacementLevels, ScoredPlayer } from "./replacement-levels";

const SUPPORTED_POSITIONS: ReadonlyArray<Position> = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
];
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

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
  auctionComplete?: boolean;
};

type CanonicalPlayer = {
  playerId: string;
  positions: Position[];
  points: number;
};

type ValuedPlayer = Omit<
  BasePlayerValue,
  "baseValue" | "displayValue" | "inflationMultiplier"
>;

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateTeams(teams: ReadonlyArray<TeamDraftState>): {
  openSlots: number;
  remainingBudget: number;
  draftedPlayerIds: Set<string>;
} {
  let openSlots = 0n;
  let remainingBudget = 0n;
  const draftedPlayerIds = new Set<string>();
  const rosterIds = new Set<number>();
  const playerOwners = new Map<string, number>();

  teams.forEach((team, index) => {
    if (rosterIds.has(team.rosterId)) {
      throw new Error(`Duplicate rosterId ${team.rosterId}`);
    }
    rosterIds.add(team.rosterId);

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

    openSlots += BigInt(team.openSlots);
    remainingBudget += BigInt(team.remainingBudget);

    const rosterPlayerIds = new Set<string>();
    team.playerIds.forEach((playerId) => {
      if (rosterPlayerIds.has(playerId)) {
        throw new Error(
          `Duplicate player ID ${playerId} within roster ${team.rosterId}`,
        );
      }
      rosterPlayerIds.add(playerId);

      const owner = playerOwners.get(playerId);
      if (owner !== undefined) {
        throw new Error(
          `Player ID ${playerId} is owned by more than one roster`,
        );
      }
      playerOwners.set(playerId, team.rosterId);
      draftedPlayerIds.add(playerId);
    });
  });

  if (openSlots > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("Aggregate open slots must be a safe integer");
  }
  if (remainingBudget > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("Aggregate remaining budget must be a safe integer");
  }

  return {
    openSlots: Number(openSlots),
    remainingBudget: Number(remainingBudget),
    draftedPlayerIds,
  };
}

function canonicalizePlayers(
  players: ReadonlyArray<ScoredPlayer>,
  draftedPlayerIds: ReadonlySet<string>,
): CanonicalPlayer[] {
  const byId = new Map<
    string,
    { playerId: string; positions: Set<Position>; points?: number }
  >();

  players.forEach((player) => {
    if (
      typeof player.playerId !== "string" ||
      draftedPlayerIds.has(player.playerId) ||
      !Array.isArray(player.positions)
    ) {
      return;
    }

    const positions = SUPPORTED_POSITIONS.filter((position) =>
      player.positions.includes(position),
    );
    if (positions.length === 0) {
      return;
    }

    const current = byId.get(player.playerId);
    const canonical = current ?? {
      playerId: player.playerId,
      positions: new Set<Position>(),
    };
    positions.forEach((position) => canonical.positions.add(position));
    if (
      Number.isFinite(player.points) &&
      (canonical.points === undefined || player.points > canonical.points)
    ) {
      canonical.points = player.points;
    }
    if (current === undefined) {
      byId.set(player.playerId, canonical);
    }
  });

  return [...byId.values()]
    .filter(
      (
        player,
      ): player is {
        playerId: string;
        positions: Set<Position>;
        points: number;
      } => player.points !== undefined,
    )
    .map((player) => ({
      playerId: player.playerId,
      positions: SUPPORTED_POSITIONS.filter((position) =>
        player.positions.has(position),
      ),
      points: player.points,
    }))
    .sort((left, right) => compareIds(left.playerId, right.playerId));
}

function vorp(points: number, replacementPoints: number): number {
  const result = Math.max(0, points - replacementPoints);
  if (!Number.isFinite(result)) {
    throw new Error("Computed VORP must be finite");
  }
  return result;
}

function blendVorp(
  starterVorp: number,
  benchVorp: number,
  starterBudgetShare: number,
): number {
  const maximum = Math.max(starterVorp, benchVorp);
  if (maximum === 0) {
    return 0;
  }

  return (
    maximum *
    ((starterVorp / maximum) * starterBudgetShare +
      (benchVorp / maximum) * (1 - starterBudgetShare))
  );
}

function valuePlayers(
  players: ReadonlyArray<CanonicalPlayer>,
  replacementLevels: ReplacementLevels,
  starterBudgetShare: number,
): ValuedPlayer[] {
  return players.map((player) => {
    const values = player.positions.map((position) => {
      const starterVorp = vorp(
        player.points,
        replacementLevels.starterPoints[position],
      );
      const benchVorp = vorp(
        player.points,
        replacementLevels.benchPoints[position],
      );
      return {
        position,
        starterVorp,
        benchVorp,
        blendedVorp: blendVorp(starterVorp, benchVorp, starterBudgetShare),
      };
    });
    const selected = values.sort(
      (left, right) =>
        right.blendedVorp - left.blendedVorp ||
        SUPPORTED_POSITIONS.indexOf(left.position) -
          SUPPORTED_POSITIONS.indexOf(right.position),
    )[0];

    return {
      playerId: player.playerId,
      points: player.points,
      ...selected,
      replacementPlayerId:
        replacementLevels.replacementPlayerIds[selected.position],
    };
  });
}

function isCapped(player: ValuedPlayer, league: LeagueConfig): boolean {
  return (
    league.capKickerDefenseAtOne &&
    (player.position === "K" || player.position === "DEF")
  );
}

function validateReplacementLevels(replacementLevels: ReplacementLevels): void {
  SUPPORTED_POSITIONS.forEach((position) => {
    if (
      !Number.isFinite(replacementLevels.starterPoints[position]) ||
      !Number.isFinite(replacementLevels.benchPoints[position])
    ) {
      throw new Error(
        `Replacement points for ${position} must be finite numbers`,
      );
    }
  });
}

function normalizedWeights(players: ReadonlyArray<ValuedPlayer>): {
  maximum: number;
  sum: number;
  byId: Map<string, number>;
} {
  const maximum = players.reduce(
    (highest, player) => Math.max(highest, player.blendedVorp),
    0,
  );
  const byId = new Map<string, number>();
  let sum = 0;

  players.forEach((player) => {
    const normalized =
      maximum > 0 && player.blendedVorp > 0 ? player.blendedVorp / maximum : 0;
    byId.set(player.playerId, normalized);
    sum += normalized;
  });

  return { maximum, sum, byId };
}

function exactDecimalWeight(value: number): {
  coefficient: bigint;
  exponent: number;
} {
  const [mantissa, exponentText] = value.toExponential(17).split("e");
  const digits = mantissa.replace(".", "");
  return {
    coefficient: BigInt(digits),
    exponent: Number(exponentText) - (digits.length - 1),
  };
}

function allocateDisplayValues(
  draftablePlayers: ReadonlyArray<ValuedPlayer>,
  minBid: number,
  extraPool: number,
  normalizedWeightById: ReadonlyMap<string, number>,
  fallbackPlayerId: string | undefined,
): Map<string, number> {
  const displayValues = new Map(
    draftablePlayers.map((player) => [player.playerId, minBid]),
  );
  if (extraPool === 0) {
    return displayValues;
  }
  if (fallbackPlayerId !== undefined) {
    displayValues.set(fallbackPlayerId, minBid + extraPool);
    return displayValues;
  }

  const decimalWeights = draftablePlayers.flatMap((player) => {
    const normalizedWeight = normalizedWeightById.get(player.playerId) ?? 0;
    if (normalizedWeight <= 0) {
      return [];
    }
    return [
      {
        id: player.playerId,
        ...exactDecimalWeight(normalizedWeight),
      },
    ];
  });
  const minimumExponent = decimalWeights.reduce(
    (minimum, item) => Math.min(minimum, item.exponent),
    0,
  );
  const scaledWeights = decimalWeights.map((item) => ({
    id: item.id,
    weight: item.coefficient * 10n ** BigInt(item.exponent - minimumExponent),
  }));
  const totalWeight = scaledWeights.reduce(
    (total, item) => total + item.weight,
    0n,
  );
  const extraPoolBigInt = BigInt(extraPool);
  const quotas = scaledWeights.map((item) => {
    const numerator = extraPoolBigInt * item.weight;
    return {
      id: item.id,
      floor: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });
  const floorTotal = quotas.reduce((total, quota) => total + quota.floor, 0n);
  const increments = Number(extraPoolBigInt - floorTotal);
  const incrementedIds = new Set(
    [...quotas]
      .sort(
        (left, right) =>
          (left.remainder > right.remainder
            ? -1
            : left.remainder < right.remainder
              ? 1
              : 0) || compareIds(left.id, right.id),
      )
      .slice(0, increments)
      .map((quota) => quota.id),
  );

  quotas.forEach((quota) => {
    displayValues.set(
      quota.id,
      minBid + Number(quota.floor) + (incrementedIds.has(quota.id) ? 1 : 0),
    );
  });
  return displayValues;
}

export function calculateBaseValues({
  league,
  strategy,
  players,
  teams,
  replacementLevels,
  preDraftDisplayValues,
}: CalculateBaseValuesInput): Map<string, BasePlayerValue> {
  if (!Number.isSafeInteger(league.minBid) || league.minBid <= 0) {
    throw new Error("League minimum bid must be a positive integer");
  }
  if (league.capKickerDefenseAtOne && league.minBid !== 1) {
    throw new Error("K/DEF $1 cap requires a $1 minimum bid");
  }
  if (
    !Number.isFinite(strategy.starterBudgetShare) ||
    strategy.starterBudgetShare < 0 ||
    strategy.starterBudgetShare > 1
  ) {
    throw new Error("starterBudgetShare must be a finite number from 0 to 1");
  }
  validateReplacementLevels(replacementLevels);

  const { openSlots, remainingBudget, draftedPlayerIds } = validateTeams(teams);
  const minimumReserveBigInt = BigInt(openSlots) * BigInt(league.minBid);
  if (minimumReserveBigInt > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("Aggregate minimum-bid reserve must be a safe integer");
  }
  const minimumReserve = Number(minimumReserveBigInt);
  if (remainingBudget < minimumReserve) {
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
  // Once every roster is full there are no remaining slots to allocate money
  // to. Keep the real final balances intact and value the undrafted review pool
  // at zero instead of inventing a live-draft budget.
  const allocatableExtraPool = openSlots === 0 ? 0 : extraPool;
  const weights = normalizedWeights(uncappedPlayers);

  if (allocatableExtraPool > 0 && uncappedPlayers.length === 0) {
    throw new Error(
      "Extra dollars cannot be allocated because every player is capped",
    );
  }

  let fallbackPlayerId: string | undefined;
  if (allocatableExtraPool > 0 && weights.maximum === 0) {
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
      const normalizedWeight = weights.byId.get(player.playerId) ?? 0;
      if (weights.sum > 0 && normalizedWeight > 0) {
        extra = allocatableExtraPool * (normalizedWeight / weights.sum);
      } else if (player.playerId === fallbackPlayerId) {
        extra = allocatableExtraPool;
      }
    }
    baseValues.set(player.playerId, league.minBid + extra);
  });

  const roundedDraftableValues = allocateDisplayValues(
    draftablePlayers,
    league.minBid,
    allocatableExtraPool,
    weights.byId,
    fallbackPlayerId,
  );

  return new Map(
    valuedPlayers.map((player) => {
      const baseValue = baseValues.get(player.playerId)!;
      const displayValue = roundedDraftableValues.get(player.playerId) ?? 0;
      const preDraftValue = preDraftDisplayValues?.get(player.playerId);
      const rawInflation =
        Number.isFinite(preDraftValue) &&
        preDraftValue !== undefined &&
        preDraftValue > 0
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
