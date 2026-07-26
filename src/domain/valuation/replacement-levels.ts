import type { LeagueConfig, Position } from "../league/types";

const POSITION_ORDER: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const OFFENSIVE_POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

export type ScoredPlayer = {
  playerId: string;
  positions: Position[];
  points: number;
};

export type ReplacementLevels = {
  starterRanks: Record<Position, number>;
  benchRanks: Record<Position, number>;
  starterPoints: Record<Position, number>;
  benchPoints: Record<Position, number>;
  replacementPlayerIds: Partial<Record<Position, string>>;
};

type CanonicalPlayer = {
  playerId: string;
  positions: Position[];
  points: number;
};

type CapacityCategory =
  | {
      kind: "fixed";
      eligible: Position[];
      position: Position;
      capacity: number;
    }
  | { kind: "flex"; eligible: Position[]; capacity: number };

type PlayerMatch = {
  categoryPlayers: number[][];
  playerCategories: Array<number | undefined>;
};

type PositionThresholds = {
  points: Record<Position, number>;
  playerIds: Partial<Record<Position, string>>;
};

function emptyPositionRecord(): Record<Position, number> {
  return {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DEF: 0,
  };
}

function comparePlayerIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEligibility(
  left: ReadonlyArray<Position>,
  right: ReadonlyArray<Position>,
): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order =
      POSITION_ORDER.indexOf(left[index]) -
      POSITION_ORDER.indexOf(right[index]);
    if (order !== 0) {
      return order;
    }
  }
  return left.length - right.length;
}

function canonicalizePlayers(
  players: ScoredPlayer[],
  draftedPlayerIds: ReadonlySet<string>,
  includePlayersWithoutFinitePoints = false,
): CanonicalPlayer[] {
  const byId = new Map<
    string,
    { playerId: string; positions: Set<Position>; points: number | undefined }
  >();

  players.forEach((player) => {
    if (draftedPlayerIds.has(player.playerId)) {
      return;
    }

    const supportedPositions = Array.isArray(player.positions)
      ? POSITION_ORDER.filter((position) => player.positions.includes(position))
      : [];
    let canonical = byId.get(player.playerId);
    if (canonical === undefined) {
      canonical = {
        playerId: player.playerId,
        positions: new Set(),
        points: undefined,
      };
      byId.set(player.playerId, canonical);
    }

    supportedPositions.forEach((position) => canonical.positions.add(position));
    if (Number.isFinite(player.points)) {
      canonical.points =
        canonical.points === undefined
          ? player.points
          : Math.max(canonical.points, player.points);
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
      } =>
        (player.points !== undefined || includePlayersWithoutFinitePoints) &&
        player.positions.size > 0,
    )
    .map((player) => ({
      playerId: player.playerId,
      positions: POSITION_ORDER.filter((position) =>
        player.positions.has(position),
      ),
      points: player.points ?? 0,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        comparePlayerIds(left.playerId, right.playerId),
    );
}

function remainingStarterCategories(
  league: LeagueConfig,
  allPlayers: ReadonlyArray<CanonicalPlayer>,
  rosteredPlayerIdsByTeam: ReadonlyArray<ReadonlyArray<string>>,
): { categories: CapacityCategory[]; fixedRanks: Record<Position, number>; occupiedBench: number } {
  const byId = new Map(allPlayers.map((player) => [player.playerId, player]));
  const perTeamLeague = { ...league, teams: 1 };
  const template = starterCategories(perTeamLeague).categories;
  const remainingBySignature = new Map<
    string,
    CapacityCategory
  >();
  let occupiedBench = 0;

  Array.from({ length: league.teams }, (_, teamIndex) => {
    const rosteredIds = rosteredPlayerIdsByTeam[teamIndex] ?? [];
    const rostered = [...new Set(rosteredIds)]
      .flatMap((playerId) => {
        const player = byId.get(playerId);
        return player === undefined ? [] : [player];
      })
      .sort(
        (left, right) =>
          comparePlayerIds(left.playerId, right.playerId),
      );
    const match = matchPlayers(rostered, template);
    occupiedBench += Math.min(
      league.bench,
      Math.max(
        0,
        rostered.length -
          match.playerCategories.filter((category) => category !== undefined)
            .length,
      ),
    );

    template.forEach((category, categoryIndex) => {
      const remaining =
        category.capacity - match.categoryPlayers[categoryIndex].length;
      if (remaining <= 0) {
        return;
      }
      const signature =
        category.kind === "fixed"
          ? `fixed:${category.position}`
          : `flex:${category.eligible.join("|")}`;
      const current = remainingBySignature.get(signature);
      if (current === undefined) {
        remainingBySignature.set(signature, { ...category, capacity: remaining });
      } else {
        current.capacity += remaining;
      }
    });
  });

  const categories = [...remainingBySignature.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "fixed" ? -1 : 1;
    }
    return (
      left.eligible.length - right.eligible.length ||
      compareEligibility(left.eligible, right.eligible)
    );
  });
  const fixedRanks = emptyPositionRecord();
  categories.forEach((category) => {
    if (category.kind === "fixed") {
      fixedRanks[category.position] += category.capacity;
    }
  });
  return { categories, fixedRanks, occupiedBench };
}

function fixedCategories(
  capacities: Readonly<Record<Position, number>>,
): CapacityCategory[] {
  return POSITION_ORDER.filter((position) => capacities[position] > 0).map(
    (position) => ({
      kind: "fixed",
      eligible: [position],
      position,
      capacity: capacities[position],
    }),
  );
}

function starterCategories(league: LeagueConfig): {
  categories: CapacityCategory[];
  fixedRanks: Record<Position, number>;
} {
  const fixedRanks = emptyPositionRecord();
  POSITION_ORDER.forEach((position) => {
    fixedRanks[position] = league.starters[position] * league.teams;
  });

  const flexCapacityBySignature = new Map<
    string,
    { eligible: Position[]; capacity: number }
  >();
  league.flex.forEach((slot) => {
    const eligible = POSITION_ORDER.filter((position) =>
      slot.eligible.includes(position),
    );
    if (eligible.length === 0) {
      return;
    }

    const signature = eligible.join("|");
    const existing = flexCapacityBySignature.get(signature);
    if (existing === undefined) {
      flexCapacityBySignature.set(signature, {
        eligible,
        capacity: slot.count * league.teams,
      });
    } else {
      existing.capacity += slot.count * league.teams;
    }
  });

  const flexCategories: CapacityCategory[] = [
    ...flexCapacityBySignature.values(),
  ]
    .sort(
      (left, right) =>
        left.eligible.length - right.eligible.length ||
        compareEligibility(left.eligible, right.eligible),
    )
    .map((category) => ({ kind: "flex", ...category }));

  return {
    categories: [...fixedCategories(fixedRanks), ...flexCategories],
    fixedRanks,
  };
}

function canFillCategory(
  player: CanonicalPlayer,
  category: CapacityCategory,
): boolean {
  return category.eligible.some((position) =>
    player.positions.includes(position),
  );
}

function matchPlayers(
  players: CanonicalPlayer[],
  categories: CapacityCategory[],
  seedAssignments: ReadonlyMap<number, number> = new Map(),
): PlayerMatch {
  const categoryPlayers: number[][] = categories.map(() => []);
  const playerCategories: Array<number | undefined> = Array(
    players.length,
  ).fill(undefined);
  seedAssignments.forEach((categoryIndex, playerIndex) => {
    categoryPlayers[categoryIndex].push(playerIndex);
    playerCategories[playerIndex] = categoryIndex;
  });
  categoryPlayers.forEach((occupants) =>
    occupants.sort((left, right) => left - right),
  );
  const eligibleCategories = players.map((player) =>
    categories.flatMap((category, categoryIndex) =>
      canFillCategory(player, category) ? [categoryIndex] : [],
    ),
  );

  function augment(
    playerIndex: number,
    visitedCategories: Set<number>,
  ): boolean {
    for (const categoryIndex of eligibleCategories[playerIndex]) {
      if (visitedCategories.has(categoryIndex)) {
        continue;
      }

      visitedCategories.add(categoryIndex);
      const occupants = categoryPlayers[categoryIndex];
      if (occupants.length < categories[categoryIndex].capacity) {
        occupants.push(playerIndex);
        occupants.sort((left, right) => left - right);
        playerCategories[playerIndex] = categoryIndex;
        return true;
      }

      for (
        let occupantIndex = 0;
        occupantIndex < occupants.length;
        occupantIndex += 1
      ) {
        const occupyingPlayerIndex = occupants[occupantIndex];
        if (augment(occupyingPlayerIndex, visitedCategories)) {
          occupants[occupantIndex] = playerIndex;
          occupants.sort((left, right) => left - right);
          playerCategories[playerIndex] = categoryIndex;
          return true;
        }
      }
    }

    return false;
  }

  players.forEach((_, playerIndex) => {
    if (playerCategories[playerIndex] === undefined) {
      augment(playerIndex, new Set());
    }
  });

  return { categoryPlayers, playerCategories };
}

function selectedPosition(
  player: CanonicalPlayer,
  category: CapacityCategory,
): Position {
  if (category.kind === "fixed") {
    return category.position;
  }

  return POSITION_ORDER.find(
    (position) =>
      player.positions.includes(position) &&
      category.eligible.includes(position),
  )!;
}

function assignedPlayerPositions(
  players: CanonicalPlayer[],
  categories: CapacityCategory[],
  match: PlayerMatch,
): Map<number, Position> {
  const positionsByPlayer = new Map<number, Position>();
  match.categoryPlayers.forEach((playerIndices, categoryIndex) => {
    playerIndices.forEach((playerIndex) => {
      positionsByPlayer.set(
        playerIndex,
        selectedPosition(players[playerIndex], categories[categoryIndex]),
      );
    });
  });
  return positionsByPlayer;
}

function playersByAssignedPosition(
  players: CanonicalPlayer[],
  positionsByPlayer: ReadonlyMap<number, Position>,
): Record<Position, CanonicalPlayer[]> {
  const assigned: Record<Position, CanonicalPlayer[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    K: [],
    DEF: [],
  };

  positionsByPlayer.forEach((position, playerIndex) => {
    assigned[position].push(players[playerIndex]);
  });
  POSITION_ORDER.forEach((position) => {
    assigned[position].sort(
      (left, right) =>
        right.points - left.points ||
        comparePlayerIds(left.playerId, right.playerId),
    );
  });

  return assigned;
}

function thresholdsAtRanks(
  assigned: Readonly<Record<Position, CanonicalPlayer[]>>,
  ranks: Readonly<Record<Position, number>>,
): PositionThresholds {
  const points = emptyPositionRecord();
  const playerIds: Partial<Record<Position, string>> = {};

  POSITION_ORDER.forEach((position) => {
    const threshold =
      ranks[position] > 0 ? assigned[position][ranks[position] - 1] : undefined;
    points[position] = threshold?.points ?? 0;
    if (threshold !== undefined) {
      playerIds[position] = threshold.playerId;
    }
  });

  return { points, playerIds };
}

function allocateBenchSlots(
  total: number,
  starterRanks: Readonly<Record<Position, number>>,
): Record<Position, number> {
  const allocations = emptyPositionRecord();
  if (total === 0) {
    return allocations;
  }

  const offensiveDemand = OFFENSIVE_POSITIONS.filter(
    (position) => starterRanks[position] > 0,
  );
  const allDemand = POSITION_ORDER.filter(
    (position) => starterRanks[position] > 0,
  );

  const eligible =
    offensiveDemand.length > 0
      ? offensiveDemand
      : allDemand.length > 0
        ? allDemand
        : OFFENSIVE_POSITIONS;
  const hasDemand = offensiveDemand.length > 0 || allDemand.length > 0;
  const totalWeight = eligible.reduce(
    (sum, position) => sum + (hasDemand ? starterRanks[position] : 1),
    0,
  );
  const remainders = eligible.map((position) => {
    const weight = hasDemand ? starterRanks[position] : 1;
    const exact = (total * weight) / totalWeight;
    const allocated = Math.floor(exact);
    allocations[position] = allocated;
    return { position, remainder: exact - allocated };
  });
  const allocated = eligible.reduce(
    (sum, position) => sum + allocations[position],
    0,
  );

  remainders.sort(
    (left, right) =>
      right.remainder - left.remainder ||
      POSITION_ORDER.indexOf(left.position) -
        POSITION_ORDER.indexOf(right.position),
  );
  for (let index = 0; index < total - allocated; index += 1) {
    allocations[remainders[index].position] += 1;
  }

  return allocations;
}

export function calculateReplacementLevels({
  league,
  players,
  draftedPlayerIds = new Set<string>(),
  rosteredPlayerIdsByTeam = [],
}: {
  league: LeagueConfig;
  players: ScoredPlayer[];
  draftedPlayerIds?: ReadonlySet<string>;
  rosteredPlayerIdsByTeam?: ReadonlyArray<ReadonlyArray<string>>;
}): ReplacementLevels {
  const canonicalPlayers = canonicalizePlayers(players, draftedPlayerIds);
  const allPlayers = canonicalizePlayers(
    players,
    new Set<string>(),
    true,
  );
  const { categories, fixedRanks, occupiedBench } =
    rosteredPlayerIdsByTeam.length > 0
      ? remainingStarterCategories(
          league,
          allPlayers,
          rosteredPlayerIdsByTeam,
        )
      : { ...starterCategories(league), occupiedBench: 0 };
  const starterMatch = matchPlayers(canonicalPlayers, categories);
  const starterPlayerPositions = assignedPlayerPositions(
    canonicalPlayers,
    categories,
    starterMatch,
  );
  const starterAssignments = playersByAssignedPosition(
    canonicalPlayers,
    starterPlayerPositions,
  );

  const starterRanks = { ...fixedRanks };
  categories.forEach((category, categoryIndex) => {
    if (category.kind === "flex") {
      starterMatch.categoryPlayers[categoryIndex].forEach((playerIndex) => {
        starterRanks[
          selectedPosition(canonicalPlayers[playerIndex], category)
        ] += 1;
      });
    }
  });
  const starterThresholds = thresholdsAtRanks(starterAssignments, starterRanks);

  const benchAllocations = allocateBenchSlots(
    Math.max(0, league.bench * league.teams - occupiedBench),
    starterRanks,
  );
  const benchRanks = emptyPositionRecord();
  POSITION_ORDER.forEach((position) => {
    benchRanks[position] = Math.max(
      starterRanks[position],
      starterRanks[position] + benchAllocations[position],
    );
  });

  const benchCapacityCategories = fixedCategories(benchRanks);
  const benchCategoryByPosition = new Map(
    benchCapacityCategories.map((category, categoryIndex) => [
      category.kind === "fixed" ? category.position : undefined,
      categoryIndex,
    ]),
  );
  const benchSeeds = new Map<number, number>();
  starterPlayerPositions.forEach((position, playerIndex) => {
    benchSeeds.set(playerIndex, benchCategoryByPosition.get(position)!);
  });
  const benchMatch = matchPlayers(
    canonicalPlayers,
    benchCapacityCategories,
    benchSeeds,
  );
  const benchPlayerPositions = assignedPlayerPositions(
    canonicalPlayers,
    benchCapacityCategories,
    benchMatch,
  );
  const benchAssignments = playersByAssignedPosition(
    canonicalPlayers,
    benchPlayerPositions,
  );
  const benchThresholds = thresholdsAtRanks(benchAssignments, benchRanks);
  const benchPoints = { ...benchThresholds.points };
  POSITION_ORDER.forEach((position) => {
    if (
      starterRanks[position] > 0 &&
      starterThresholds.playerIds[position] !== undefined &&
      benchThresholds.playerIds[position] !== undefined
    ) {
      benchPoints[position] = Math.min(
        benchPoints[position],
        starterThresholds.points[position],
      );
    }
  });

  return {
    starterRanks,
    benchRanks,
    starterPoints: starterThresholds.points,
    benchPoints,
    replacementPlayerIds: starterThresholds.playerIds,
  };
}
