import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";

import {
  SleeperDraftSchema,
  SleeperLeagueSchema,
  SleeperPickSchema,
  SleeperRosterSchema,
  SleeperUserSchema,
  type SleeperPlayerMap,
} from "./schemas";

export class UnsupportedDraftTypeError extends Error {
  readonly code = "UNSUPPORTED_DRAFT_TYPE";

  constructor() {
    super("Unsupported Sleeper draft type");
    this.name = "UnsupportedDraftTypeError";
  }
}

export type SourceTeam = {
  rosterId: number;
  userId: string | null;
  name: string;
};

export type NormalizedDraft = {
  snapshot: DraftSnapshot;
  teams: SourceTeam[];
  users: Array<ReturnType<typeof SleeperUserSchema.parse>>;
  players: SleeperPlayerMap;
  quarantinedPicks: unknown[];
};

type NormalizeInput = {
  draft: unknown;
  picks: unknown[];
  league?: unknown;
  users?: unknown[];
  rosters?: unknown[];
  players?: SleeperPlayerMap;
  now?: Date;
};

const flexEligible: Record<string, Position[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

function numberSetting(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strictPositiveAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^(?:\d+|\d+\.\d+|\.\d+)$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function keeper(metadata: Record<string, unknown>): boolean {
  return [metadata.is_keeper, metadata.keeper].some(
    (value) => value === true || value === 1 || value === "1" || value === "true",
  );
}

function rosterCounts(draftSettings: Record<string, unknown>, rosterPositions?: string[]) {
  const counts = new Map<string, number>();
  rosterPositions?.forEach((position) => counts.set(position, (counts.get(position) ?? 0) + 1));
  const from = (position: string, key: string) =>
    rosterPositions ? (counts.get(position) ?? 0) : numberSetting(draftSettings[key]);
  return {
    starters: {
      QB: from("QB", "slots_qb"),
      RB: from("RB", "slots_rb"),
      WR: from("WR", "slots_wr"),
      TE: from("TE", "slots_te"),
      K: from("K", "slots_k"),
      DEF: from("DEF", "slots_def"),
    },
    bench: from("BN", "slots_bn"),
    flex: Object.entries(flexEligible)
      .map(([name, eligible]) => ({
        count: rosterPositions
          ? (counts.get(name) ?? 0)
          : numberSetting(
              draftSettings[
                name === "WRRB_FLEX"
                  ? "slots_wrrb_flex"
                  : name === "REC_FLEX"
                    ? "slots_rec_flex"
                    : name === "SUPER_FLEX"
                      ? "slots_super_flex"
                      : "slots_flex"
              ],
            ),
        eligible,
      }))
      .filter((slot) => slot.count > 0),
  };
}

function sourceTeams(
  teams: number,
  draft: ReturnType<typeof SleeperDraftSchema.parse>,
  users: Array<ReturnType<typeof SleeperUserSchema.parse>>,
  rosters: Array<ReturnType<typeof SleeperRosterSchema.parse>>,
): SourceTeam[] {
  if (draft.league_id == null) {
    const nameBySlot = new Map(
      Object.entries(draft.draft_order ?? {}).map(([name, slot]) => [slot, name]),
    );
    return Array.from({ length: teams }, (_, index) => {
      const slot = index + 1;
      const rawRosterId = draft.slot_to_roster_id?.[String(slot)] ?? slot;
      const rosterId = Number(rawRosterId);
      return { rosterId, userId: null, name: nameBySlot.get(slot) ?? `Team ${rosterId}` };
    });
  }

  const userById = new Map(users.map((user) => [String(user.user_id), user]));
  const byRoster = new Map(rosters.map((roster) => [roster.roster_id, roster]));
  return Array.from({ length: teams }, (_, index) => {
    const rosterId = index + 1;
    const roster = byRoster.get(rosterId);
    const userId = roster?.owner_id == null ? null : String(roster.owner_id);
    const user = userId ? userById.get(userId) : undefined;
    const metadataName =
      typeof user?.metadata?.team_name === "string" ? user.metadata.team_name : undefined;
    return {
      rosterId,
      userId,
      name: metadataName ?? user?.display_name ?? user?.username ?? `Team ${rosterId}`,
    };
  });
}

function status(value: string): DraftSnapshot["status"] {
  if (value === "complete") return "complete";
  if (value === "drafting" || value === "in_progress") return "drafting";
  return "pre";
}

export function normalizeDraft(input: NormalizeInput): NormalizedDraft {
  const draft = SleeperDraftSchema.parse(input.draft);
  if (draft.type !== "auction") throw new UnsupportedDraftTypeError();

  const league = input.league === undefined ? undefined : SleeperLeagueSchema.parse(input.league);
  const users = (input.users ?? []).map((user) => SleeperUserSchema.parse(user));
  const rosters = (input.rosters ?? []).map((roster) => SleeperRosterSchema.parse(roster));
  const teamCount = league?.total_rosters ?? numberSetting(draft.settings.teams);
  const budget = numberSetting(draft.settings.budget, 200);
  const slotConfig = rosterCounts(draft.settings, league?.roster_positions);
  const scoring = league?.scoring_settings ?? {};
  const config = createLeagueConfig({
    teams: teamCount,
    budget,
    minBid: 1,
    ...slotConfig,
    receptionPoints: numberSetting(scoring.rec, 0),
    scoring: {
      passYard: numberSetting(scoring.pass_yd, 0.04),
      passTd: numberSetting(scoring.pass_td, 4),
      interception: numberSetting(scoring.pass_int, -2),
      rushYard: numberSetting(scoring.rush_yd, 0.1),
      rushTd: numberSetting(scoring.rush_td, 6),
      receivingYard: numberSetting(scoring.rec_yd, 0.1),
      receivingTd: numberSetting(scoring.rec_td, 6),
      fumbleLost: numberSetting(scoring.fum_lost, -2),
      positionReceptionBonus: {
        TE: numberSetting(scoring.bonus_rec_te, 0),
      },
    },
  });

  const parsedGroups = new Map<
    string,
    Array<{ raw: unknown; pick: ReturnType<typeof SleeperPickSchema.parse>; amount: number }>
  >();
  const quarantinedPicks: unknown[] = [];
  for (const raw of input.picks) {
    const parsed = SleeperPickSchema.safeParse(raw);
    if (!parsed.success) {
      quarantinedPicks.push(raw);
      continue;
    }
    const amount = strictPositiveAmount(parsed.data.metadata.amount);
    if (amount === null) {
      quarantinedPicks.push(raw);
      continue;
    }
    const key = `${parsed.data.pick_no}:${parsed.data.player_id}:${parsed.data.roster_id}`;
    const group = parsedGroups.get(key) ?? [];
    group.push({ raw, pick: parsed.data, amount });
    parsedGroups.set(key, group);
  }

  const purchases: DraftPurchase[] = [];
  [...parsedGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach(([, group]) => {
      const signatures = new Set(
        group.map(({ amount, pick }) => `${amount}:${keeper(pick.metadata)}`),
      );
      if (signatures.size > 1) {
        quarantinedPicks.push(...group.map(({ raw }) => raw));
        return;
      }
      const { pick, amount } = group[0];
      purchases.push({
        draftId: String(draft.draft_id),
        playerId: String(pick.player_id),
        rosterId: pick.roster_id,
        amount,
        pickNo: pick.pick_no,
        createdAt:
          typeof pick.metadata.created_at === "string" ? pick.metadata.created_at : null,
        source: "sleeper",
        keeper: keeper(pick.metadata),
      });
    });

  const teamMetadata = sourceTeams(teamCount, draft, users, rosters);
  const snapshotTeams = teamMetadata.map((team) => {
    const teamPurchases = purchases.filter((purchase) => purchase.rosterId === team.rosterId);
    return {
      rosterId: team.rosterId,
      name: team.name,
      remainingBudget: budget - teamPurchases.reduce((sum, pick) => sum + pick.amount, 0),
      openSlots: Math.max(0, config.rosterSize - teamPurchases.length),
      playerIds: teamPurchases.map((pick) => pick.playerId),
    };
  });

  return {
    snapshot: {
      draftId: String(draft.draft_id),
      status: status(draft.status),
      type: "auction",
      league: config,
      teams: snapshotTeams,
      purchases,
      lastUpdatedAt: (input.now ?? new Date()).toISOString(),
    },
    teams: teamMetadata,
    users,
    players: input.players ?? {},
    quarantinedPicks,
  };
}
