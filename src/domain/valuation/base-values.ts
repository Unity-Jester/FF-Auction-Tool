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

type CapacityValuedPlayer = ValuedPlayer & {
  hasCapacity: boolean;
};

type PositionValuation = Pick<
  CapacityValuedPlayer,
  "position" | "starterVorp" | "benchVorp" | "blendedVorp" | "hasCapacity"
>;

function publicValuedPlayer(player: CapacityValuedPlayer): ValuedPlayer {
  return {
    playerId: player.playerId,
    position: player.position,
    points: player.points,
    starterVorp: player.starterVorp,
    benchVorp: player.benchVorp,
    blendedVorp: player.blendedVorp,
    replacementPlayerId: player.replacementPlayerId,
  };
}

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

function positionValuations(
  player: CanonicalPlayer,
  replacementLevels: ReplacementLevels,
  starterBudgetShare: number,
): PositionValuation[] {
  return player.positions.map((position) => {
    const hasStarterCapacity = replacementLevels.starterRanks[position] > 0;
    const hasBenchCapacity = replacementLevels.benchRanks[position] > 0;
    const starterVorp = hasStarterCapacity
      ? vorp(player.points, replacementLevels.starterPoints[position])
      : 0;
    const benchVorp = hasBenchCapacity
      ? vorp(player.points, replacementLevels.benchPoints[position])
      : 0;
    return {
      position,
      starterVorp,
      benchVorp,
      blendedVorp: blendVorp(starterVorp, benchVorp, starterBudgetShare),
      hasCapacity: hasStarterCapacity || hasBenchCapacity,
    };
  });
}

function valuePlayers(
  players: ReadonlyArray<CanonicalPlayer>,
  replacementLevels: ReplacementLevels,
  starterBudgetShare: number,
): CapacityValuedPlayer[] {
  return players.map((player) => {
    const values = positionValuations(
      player,
      replacementLevels,
      starterBudgetShare,
    );
    const selected = values.sort(
      (left, right) =>
        Number(right.hasCapacity) - Number(left.hasCapacity) ||
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

type FlowEdge = {
  to: number;
  reverseIndex: number;
  capacity: number;
  cost: number;
  position?: Position;
};

function selectCapacityAwarePool(
  players: ReadonlyArray<CanonicalPlayer>,
  replacementLevels: ReplacementLevels,
  starterBudgetShare: number,
  openSlots: number,
): CapacityValuedPlayer[] {
  if (openSlots === 0) return [];
  const candidates = players.map((player) => ({
    player,
    values: positionValuations(
      player,
      replacementLevels,
      starterBudgetShare,
    ).filter((value) => value.hasCapacity),
  }));
  const maximumVorp = candidates.reduce(
    (maximum, candidate) =>
      candidate.values.reduce(
        (innerMaximum, value) =>
          Math.max(innerMaximum, value.blendedVorp),
        maximum,
      ),
    0,
  );
  const pointValues = candidates.map(({ player }) => player.points);
  const minimumPoints = Math.min(...pointValues);
  const maximumPoints = Math.max(...pointValues);
  const pointRange = maximumPoints - minimumPoints;
  const source = 0;
  const playerOffset = 1;
  const positionOffset = playerOffset + candidates.length;
  const sink = positionOffset + SUPPORTED_POSITIONS.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (
    from: number,
    to: number,
    capacity: number,
    cost: number,
    position?: Position,
  ) => {
    const forward: FlowEdge = {
      to,
      reverseIndex: graph[to].length,
      capacity,
      cost,
      position,
    };
    const reverse: FlowEdge = {
      to: from,
      reverseIndex: graph[from].length,
      capacity: 0,
      cost: -cost,
    };
    graph[from].push(forward);
    graph[to].push(reverse);
  };

  candidates.forEach((candidate, playerIndex) => {
    const playerNode = playerOffset + playerIndex;
    addEdge(source, playerNode, 1, 0);
    candidate.values.forEach((value) => {
      const normalizedVorp =
        maximumVorp > 0 ? value.blendedVorp / maximumVorp : 0;
      const normalizedPoints =
        pointRange > 0
          ? (candidate.player.points - minimumPoints) / pointRange
          : 1;
      const stablePlayerTie =
        (candidates.length - playerIndex) /
        Math.max(1, candidates.length);
      const stablePositionTie =
        (SUPPORTED_POSITIONS.length -
          SUPPORTED_POSITIONS.indexOf(value.position)) /
        SUPPORTED_POSITIONS.length;
      const score =
        normalizedVorp * 1e12 +
        normalizedPoints * 1e6 +
        stablePlayerTie * 1e3 +
        stablePositionTie;
      addEdge(
        playerNode,
        positionOffset + SUPPORTED_POSITIONS.indexOf(value.position),
        1,
        -score,
        value.position,
      );
    });
  });
  SUPPORTED_POSITIONS.forEach((position, index) => {
    const capacity = Math.max(
      replacementLevels.starterRanks[position],
      replacementLevels.benchRanks[position],
    );
    if (capacity > 0) {
      addEdge(positionOffset + index, sink, Math.min(capacity, openSlots), 0);
    }
  });

  let flow = 0;
  while (flow < openSlots) {
    const distances = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    const queued = Array<boolean>(graph.length).fill(false);
    const queue = [source];
    distances[source] = 0;
    queued[source] = true;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = queue[cursor];
      queued[node] = false;
      graph[node].forEach((edge, edgeIndex) => {
        if (edge.capacity <= 0) return;
        const distance = distances[node] + edge.cost;
        if (distance >= distances[edge.to] - 1e-9) return;
        distances[edge.to] = distance;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        if (!queued[edge.to]) {
          queue.push(edge.to);
          queued[edge.to] = true;
        }
      });
    }
    if (previousNode[sink] === -1) {
      throw new Error(
        "Remaining capacity-aware player pool cannot fill every open slot",
      );
    }
    for (let node = sink; node !== source; node = previousNode[node]) {
      const from = previousNode[node];
      const edge = graph[from][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverseIndex].capacity += 1;
    }
    flow += 1;
  }

  return candidates.flatMap((candidate, playerIndex) => {
    const assignedEdge = graph[playerOffset + playerIndex].find(
      (edge) => edge.position !== undefined && edge.capacity === 0,
    );
    if (assignedEdge?.position === undefined) return [];
    const selected = candidate.values.find(
      (value) => value.position === assignedEdge.position,
    )!;
    return [{
      playerId: candidate.player.playerId,
      points: candidate.player.points,
      ...selected,
      replacementPlayerId:
        replacementLevels.replacementPlayerIds[selected.position],
    }];
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
      !Number.isSafeInteger(replacementLevels.starterRanks[position]) ||
      replacementLevels.starterRanks[position] < 0 ||
      !Number.isSafeInteger(replacementLevels.benchRanks[position]) ||
      replacementLevels.benchRanks[position] < 0
    ) {
      throw new Error(
        `Replacement ranks for ${position} must be non-negative integers`,
      );
    }
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
  const draftablePlayers = selectCapacityAwarePool(
    canonicalPlayers,
    replacementLevels,
    strategy.starterBudgetShare,
    openSlots,
  ).sort(
    (left, right) =>
      right.blendedVorp - left.blendedVorp ||
      right.points - left.points ||
      compareIds(left.playerId, right.playerId),
  );
  const draftableById = new Map(
    draftablePlayers.map((player) => [player.playerId, player]),
  );
  const outputValuedPlayers = valuedPlayers.map(
    (player) => draftableById.get(player.playerId) ?? player,
  );
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
  outputValuedPlayers.forEach((player) => {
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
    outputValuedPlayers.map((player) => {
      const publicPlayer = publicValuedPlayer(player);
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
          ...publicPlayer,
          baseValue,
          displayValue,
          inflationMultiplier,
        },
      ];
    }),
  );
}
