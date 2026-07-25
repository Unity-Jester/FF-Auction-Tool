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

type CapacitySlot =
  | { kind: "fixed"; eligible: Position[]; position: Position }
  | { kind: "flex"; eligible: Position[] };

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
      } => player.points !== undefined && player.positions.size > 0,
    )
    .map((player) => ({
      playerId: player.playerId,
      positions: POSITION_ORDER.filter((position) =>
        player.positions.has(position),
      ),
      points: player.points,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        comparePlayerIds(left.playerId, right.playerId),
    );
}

function fixedSlots(
  capacities: Readonly<Record<Position, number>>,
): CapacitySlot[] {
  return POSITION_ORDER.flatMap((position) =>
    Array.from({ length: capacities[position] }, (): CapacitySlot => ({
      kind: "fixed",
      eligible: [position],
      position,
    })),
  );
}

function starterSlots(league: LeagueConfig): {
  slots: CapacitySlot[];
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

  const flexSlots = [...flexCapacityBySignature.values()]
    .sort(
      (left, right) =>
        left.eligible.length - right.eligible.length ||
        compareEligibility(left.eligible, right.eligible),
    )
    .flatMap((category) =>
      Array.from({ length: category.capacity }, (): CapacitySlot => ({
        kind: "flex",
        eligible: category.eligible,
      })),
    );

  return { slots: [...fixedSlots(fixedRanks), ...flexSlots], fixedRanks };
}

function canFillSlot(player: CanonicalPlayer, slot: CapacitySlot): boolean {
  return slot.eligible.some((position) => player.positions.includes(position));
}

function matchPlayers(
  players: CanonicalPlayer[],
  slots: CapacitySlot[],
): Array<number | undefined> {
  const slotPlayers: Array<number | undefined> = Array(slots.length).fill(
    undefined,
  );

  function augment(playerIndex: number, visitedSlots: Set<number>): boolean {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (
        visitedSlots.has(slotIndex) ||
        !canFillSlot(players[playerIndex], slots[slotIndex])
      ) {
        continue;
      }

      visitedSlots.add(slotIndex);
      const occupyingPlayer = slotPlayers[slotIndex];
      if (
        occupyingPlayer === undefined ||
        augment(occupyingPlayer, visitedSlots)
      ) {
        slotPlayers[slotIndex] = playerIndex;
        return true;
      }
    }

    return false;
  }

  players.forEach((_, playerIndex) => {
    augment(playerIndex, new Set());
  });

  return slotPlayers;
}

function selectedPosition(
  player: CanonicalPlayer,
  slot: CapacitySlot,
): Position {
  if (slot.kind === "fixed") {
    return slot.position;
  }

  return POSITION_ORDER.find(
    (position) =>
      player.positions.includes(position) && slot.eligible.includes(position),
  )!;
}

function playersByAssignedPosition(
  players: CanonicalPlayer[],
  slots: CapacitySlot[],
  slotPlayers: Array<number | undefined>,
): Record<Position, CanonicalPlayer[]> {
  const assigned: Record<Position, CanonicalPlayer[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    K: [],
    DEF: [],
  };

  slotPlayers.forEach((playerIndex, slotIndex) => {
    if (playerIndex === undefined) {
      return;
    }

    const player = players[playerIndex];
    const position = selectedPosition(player, slots[slotIndex]);
    assigned[position].push(player);
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

function supplyByPosition(
  players: CanonicalPlayer[],
): Record<Position, number> {
  const supply = emptyPositionRecord();
  players.forEach((player) => {
    player.positions.forEach((position) => {
      supply[position] += 1;
    });
  });
  return supply;
}

function allocateBenchSlots(
  total: number,
  starterRanks: Readonly<Record<Position, number>>,
  players: CanonicalPlayer[],
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
  const supply = supplyByPosition(players);
  const offensiveSupply = OFFENSIVE_POSITIONS.filter(
    (position) => supply[position] > 0,
  );
  const allSupply = POSITION_ORDER.filter((position) => supply[position] > 0);

  const eligible =
    offensiveDemand.length > 0
      ? offensiveDemand
      : allDemand.length > 0
        ? allDemand
        : offensiveSupply.length > 0
          ? offensiveSupply
          : allSupply;
  if (eligible.length === 0) {
    return allocations;
  }

  const weights =
    offensiveDemand.length > 0 || allDemand.length > 0 ? starterRanks : supply;
  const totalWeight = eligible.reduce(
    (sum, position) => sum + weights[position],
    0,
  );
  const remainders = eligible.map((position) => {
    const exact = (total * weights[position]) / totalWeight;
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
}: {
  league: LeagueConfig;
  players: ScoredPlayer[];
  draftedPlayerIds?: ReadonlySet<string>;
}): ReplacementLevels {
  const canonicalPlayers = canonicalizePlayers(players, draftedPlayerIds);
  const { slots, fixedRanks } = starterSlots(league);
  const starterSlotPlayers = matchPlayers(canonicalPlayers, slots);
  const starterAssignments = playersByAssignedPosition(
    canonicalPlayers,
    slots,
    starterSlotPlayers,
  );

  const starterRanks = { ...fixedRanks };
  slots.forEach((slot, slotIndex) => {
    const playerIndex = starterSlotPlayers[slotIndex];
    if (slot.kind === "flex" && playerIndex !== undefined) {
      starterRanks[selectedPosition(canonicalPlayers[playerIndex], slot)] += 1;
    }
  });
  const starterThresholds = thresholdsAtRanks(starterAssignments, starterRanks);

  const benchAllocations = allocateBenchSlots(
    league.bench * league.teams,
    starterRanks,
    canonicalPlayers,
  );
  const benchRanks = emptyPositionRecord();
  POSITION_ORDER.forEach((position) => {
    benchRanks[position] = Math.max(
      starterRanks[position],
      starterRanks[position] + benchAllocations[position],
    );
  });

  const benchCapacitySlots = fixedSlots(benchRanks);
  const benchSlotPlayers = matchPlayers(canonicalPlayers, benchCapacitySlots);
  const benchAssignments = playersByAssignedPosition(
    canonicalPlayers,
    benchCapacitySlots,
    benchSlotPlayers,
  );
  const benchThresholds = thresholdsAtRanks(benchAssignments, benchRanks);

  return {
    starterRanks,
    benchRanks,
    starterPoints: starterThresholds.points,
    benchPoints: benchThresholds.points,
    replacementPlayerIds: starterThresholds.playerIds,
  };
}
