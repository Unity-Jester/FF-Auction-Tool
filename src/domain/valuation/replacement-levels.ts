import type { LeagueConfig, Position } from "../league/types";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const offensivePositions: Position[] = ["QB", "RB", "WR", "TE"];

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

function allocateBenchSlots(
  total: number,
  starterRanks: Readonly<Record<Position, number>>,
): Record<Position, number> {
  const allocations = emptyPositionRecord();
  const offenseWithDemand = offensivePositions.filter(
    (position) => starterRanks[position] > 0,
  );
  const eligible =
    offenseWithDemand.length > 0
      ? offenseWithDemand
      : positions.filter((position) => starterRanks[position] > 0);

  if (eligible.length === 0 || total === 0) {
    return allocations;
  }

  const totalDemand = eligible.reduce(
    (sum, position) => sum + starterRanks[position],
    0,
  );
  const remainders = eligible.map((position) => {
    const exact = (total * starterRanks[position]) / totalDemand;
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
      positions.indexOf(left.position) - positions.indexOf(right.position),
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
  const pools: Record<Position, ScoredPlayer[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    K: [],
    DEF: [],
  };

  players.forEach((player) => {
    if (
      draftedPlayerIds.has(player.playerId) ||
      !Number.isFinite(player.points) ||
      !Array.isArray(player.positions)
    ) {
      return;
    }

    const position = player.positions.find((candidate): candidate is Position =>
      positions.includes(candidate),
    );
    if (position !== undefined) {
      pools[position].push(player);
    }
  });

  positions.forEach((position) => {
    pools[position].sort(
      (left, right) =>
        right.points - left.points ||
        left.playerId.localeCompare(right.playerId),
    );
  });

  const starterRanks = emptyPositionRecord();
  positions.forEach((position) => {
    starterRanks[position] = league.starters[position] * league.teams;
  });

  league.flex.forEach((slot) => {
    const openings = slot.count * league.teams;
    for (let opening = 0; opening < openings; opening += 1) {
      const candidates = positions
        .filter((position) => slot.eligible.includes(position))
        .map((position) => ({
          position,
          player: pools[position][starterRanks[position]],
        }))
        .filter(
          (
            candidate,
          ): candidate is {
            position: Position;
            player: ScoredPlayer;
          } => candidate.player !== undefined,
        )
        .sort(
          (left, right) =>
            right.player.points - left.player.points ||
            positions.indexOf(left.position) -
              positions.indexOf(right.position),
        );

      const selected = candidates[0];
      if (selected !== undefined) {
        starterRanks[selected.position] += 1;
      }
    }
  });

  const benchAllocations = allocateBenchSlots(
    league.bench * league.teams,
    starterRanks,
  );
  const benchRanks = emptyPositionRecord();
  const starterPoints = emptyPositionRecord();
  const benchPoints = emptyPositionRecord();
  const replacementPlayerIds: Partial<Record<Position, string>> = {};

  positions.forEach((position) => {
    benchRanks[position] = Math.max(
      starterRanks[position],
      starterRanks[position] + benchAllocations[position],
    );

    const starterPlayer =
      starterRanks[position] > 0
        ? pools[position][starterRanks[position] - 1]
        : undefined;
    const benchPlayer =
      benchRanks[position] > 0
        ? pools[position][benchRanks[position] - 1]
        : undefined;
    starterPoints[position] = starterPlayer?.points ?? 0;
    benchPoints[position] = benchPlayer?.points ?? 0;
    if (starterPlayer !== undefined) {
      replacementPlayerIds[position] = starterPlayer.playerId;
    }
  });

  return {
    starterRanks,
    benchRanks,
    starterPoints,
    benchPoints,
    replacementPlayerIds,
  };
}
