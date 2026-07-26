import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";
import { createLeagueConfig } from "@/domain/league/defaults";
import type { Position } from "@/domain/league/types";

import {
  SleeperDraftSchema,
  SleeperLeagueSchema,
  SleeperPickSchema,
  SleeperRosterSchema,
  SleeperUserSchema,
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
  quarantinedPicks: QuarantinedPick[];
  warnings: DraftWarning[];
};

export type QuarantinedPick = {
  reason:
    | "INVALID_PICK"
    | "INVALID_AMOUNT"
    | "UNRESOLVED_ROSTER"
    | "CONFLICTING_DUPLICATE";
  index: number;
  draftId?: string;
  playerId?: string;
  rosterId?: number;
  pickNo?: number;
};

export type DraftWarning = {
  code: "SCORING_INFERRED" | "SCORING_DEFAULTED";
  source: "draft.metadata.scoring_type";
  message: string;
};

type NormalizeInput = {
  draft: unknown;
  picks: unknown[];
  league?: unknown;
  users?: unknown[];
  rosters?: unknown[];
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
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value))
    return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function keeper(topLevel: unknown, metadata: Record<string, unknown>): boolean {
  return [topLevel, metadata.is_keeper, metadata.keeper].some(
    (value) =>
      value === true || value === 1 || value === "1" || value === "true",
  );
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  const identifier = String(value);
  return /^[A-Za-z0-9_-]{1,64}$/.test(identifier) ? identifier : undefined;
}

function quarantine(
  raw: unknown,
  index: number,
  reason: QuarantinedPick["reason"],
): QuarantinedPick {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rosterId =
    typeof record.roster_id === "number" &&
    Number.isInteger(record.roster_id) &&
    record.roster_id > 0
      ? record.roster_id
      : undefined;
  const pickNo =
    typeof record.pick_no === "number" &&
    Number.isInteger(record.pick_no) &&
    record.pick_no > 0
      ? record.pick_no
      : undefined;
  const draftId = safeIdentifier(record.draft_id);
  const playerId = safeIdentifier(record.player_id);
  return {
    reason,
    index,
    ...(draftId ? { draftId } : {}),
    ...(playerId ? { playerId } : {}),
    ...(rosterId ? { rosterId } : {}),
    ...(pickNo ? { pickNo } : {}),
  };
}

function rosterCounts(
  draftSettings: Record<string, unknown>,
  rosterPositions?: string[],
) {
  const counts = new Map<string, number>();
  rosterPositions?.forEach((position) =>
    counts.set(position, (counts.get(position) ?? 0) + 1),
  );
  const from = (position: string, key: string) =>
    rosterPositions
      ? (counts.get(position) ?? 0)
      : numberSetting(draftSettings[key]);
  const starters = {
    QB: from("QB", "slots_qb"),
    RB: from("RB", "slots_rb"),
    WR: from("WR", "slots_wr"),
    TE: from("TE", "slots_te"),
    K: from("K", "slots_k"),
    DEF: from("DEF", "slots_def"),
  };
  const flex = Object.entries(flexEligible)
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
    .filter((slot) => slot.count > 0);
  const fixedCount = Object.values(starters).reduce(
    (sum, count) => sum + count,
    0,
  );
  const flexCount = flex.reduce((sum, slot) => sum + slot.count, 0);
  const hasBench = rosterPositions
    ? counts.has("BN")
    : Object.prototype.hasOwnProperty.call(draftSettings, "slots_bn");
  const rounds = numberSetting(draftSettings.rounds);
  const bench = hasBench
    ? from("BN", "slots_bn")
    : Math.max(0, rounds - fixedCount - flexCount);

  return { starters, bench, flex };
}

function sourceTeams(
  teams: number,
  draft: ReturnType<typeof SleeperDraftSchema.parse>,
  users: Array<ReturnType<typeof SleeperUserSchema.parse>>,
  rosters: Array<ReturnType<typeof SleeperRosterSchema.parse>>,
): SourceTeam[] {
  if (draft.league_id == null) {
    const userIdBySlot = new Map(
      Object.entries(draft.draft_order ?? {}).map(([userId, slot]) => [
        slot,
        userId,
      ]),
    );
    const userById = new Map(users.map((user) => [String(user.user_id), user]));
    return Array.from({ length: teams }, (_, index) => {
      const slot = index + 1;
      const rawRosterId = draft.slot_to_roster_id?.[String(slot)] ?? slot;
      const rosterId = Number(rawRosterId);
      const userId = userIdBySlot.get(slot) ?? null;
      const user = userId ? userById.get(userId) : undefined;
      return {
        rosterId,
        userId,
        name: user?.display_name ?? user?.username ?? `Team ${slot}`,
      };
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
      typeof user?.metadata?.team_name === "string"
        ? user.metadata.team_name
        : undefined;
    return {
      rosterId,
      userId,
      name:
        metadataName ??
        user?.display_name ??
        user?.username ??
        `Team ${rosterId}`,
    };
  });
}

function status(value: string): DraftSnapshot["status"] {
  if (value === "complete") return "complete";
  if (value === "drafting" || value === "in_progress" || value === "paused") {
    return "drafting";
  }
  return "pre";
}

export function normalizeDraft(input: NormalizeInput): NormalizedDraft {
  const draft = SleeperDraftSchema.parse(input.draft);
  if (draft.type !== "auction") throw new UnsupportedDraftTypeError();

  const league =
    input.league === undefined
      ? undefined
      : SleeperLeagueSchema.parse(input.league);
  const users = (input.users ?? []).map((user) =>
    SleeperUserSchema.parse(user),
  );
  const rosters = (input.rosters ?? []).map((roster) =>
    SleeperRosterSchema.parse(roster),
  );
  const teamCount =
    league?.total_rosters ?? numberSetting(draft.settings.teams);
  const budget = numberSetting(draft.settings.budget, 200);
  const slotConfig = rosterCounts(draft.settings, league?.roster_positions);
  const scoring = league?.scoring_settings ?? {};
  const scoringType =
    typeof draft.metadata?.scoring_type === "string"
      ? draft.metadata.scoring_type.toLowerCase()
      : "";
  const mockReceptionByType: Record<string, number> = {
    standard: 0,
    non_ppr: 0,
    half_ppr: 0.5,
    ppr: 1,
  };
  const inferredMockScoring = Object.prototype.hasOwnProperty.call(
    mockReceptionByType,
    scoringType,
  );
  const warnings: DraftWarning[] =
    league === undefined
      ? [
          {
            code: inferredMockScoring
              ? "SCORING_INFERRED"
              : "SCORING_DEFAULTED",
            source: "draft.metadata.scoring_type",
            message: inferredMockScoring
              ? `Reception scoring inferred from ${scoringType}`
              : "Unknown mock scoring type; defaulted receptions to zero",
          },
        ]
      : [];
  const config = createLeagueConfig({
    teams: teamCount,
    budget,
    minBid: 1,
    ...slotConfig,
    receptionPoints:
      league === undefined
        ? (mockReceptionByType[scoringType] ?? 0)
        : numberSetting(scoring.rec, 0),
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
        RB: numberSetting(scoring.bonus_rec_rb, 0),
        WR: numberSetting(scoring.bonus_rec_wr, 0),
        TE: numberSetting(scoring.bonus_rec_te, 0),
      },
    },
  });

  const parsedGroups = new Map<
    string,
    Array<{
      raw: unknown;
      index: number;
      purchase: DraftPurchase;
    }>
  >();
  const quarantinedPicks: QuarantinedPick[] = [];
  for (const [index, raw] of input.picks.entries()) {
    const parsed = SleeperPickSchema.safeParse(raw);
    if (!parsed.success) {
      quarantinedPicks.push(quarantine(raw, index, "INVALID_PICK"));
      continue;
    }
    const amount = strictPositiveAmount(parsed.data.metadata.amount);
    if (amount === null) {
      quarantinedPicks.push(quarantine(raw, index, "INVALID_AMOUNT"));
      continue;
    }
    const mappedRosterId = Number(
      draft.slot_to_roster_id?.[String(parsed.data.draft_slot)],
    );
    const fallbackRosterId =
      parsed.data.draft_slot <= teamCount ? parsed.data.draft_slot : null;
    const rosterId =
      parsed.data.roster_id ??
      (Number.isInteger(mappedRosterId) && mappedRosterId > 0
        ? mappedRosterId
        : fallbackRosterId);
    if (rosterId === null) {
      quarantinedPicks.push(quarantine(raw, index, "UNRESOLVED_ROSTER"));
      continue;
    }
    const purchase: DraftPurchase = {
      draftId: String(draft.draft_id),
      playerId: String(parsed.data.player_id),
      rosterId,
      amount,
      pickNo: parsed.data.pick_no,
      createdAt:
        typeof parsed.data.metadata.created_at === "string"
          ? parsed.data.metadata.created_at
          : null,
      source: "sleeper",
      keeper: keeper(parsed.data.is_keeper, parsed.data.metadata),
    };
    const key = JSON.stringify([
      purchase.draftId,
      purchase.playerId,
      purchase.rosterId,
    ]);
    const group = parsedGroups.get(key) ?? [];
    group.push({ raw, index, purchase });
    parsedGroups.set(key, group);
  }

  const purchases: DraftPurchase[] = [];
  [...parsedGroups.entries()].forEach(([, group]) => {
    const signatures = new Set(
      group.map(({ purchase }) => JSON.stringify(purchase)),
    );
    if (signatures.size > 1) {
      quarantinedPicks.push(
        ...group.map(({ raw, index }) =>
          quarantine(raw, index, "CONFLICTING_DUPLICATE"),
        ),
      );
      return;
    }
    purchases.push(group[0].purchase);
  });
  purchases.sort(
    (a, b) =>
      a.pickNo - b.pickNo ||
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.playerId.localeCompare(b.playerId),
  );

  const teamMetadata = sourceTeams(teamCount, draft, users, rosters);
  const rosterById = new Map(rosters.map((roster) => [roster.roster_id, roster]));
  const snapshotTeams = teamMetadata.map((team) => {
    const teamPurchases = purchases.filter(
      (purchase) => purchase.rosterId === team.rosterId,
    );
    const purchasedIds = new Set(teamPurchases.map((pick) => pick.playerId));
    const unknownCostPlayerIds = [
      ...new Set(
        (rosterById.get(team.rosterId)?.players ?? []).flatMap((playerId) => {
          const id = safeIdentifier(playerId);
          return id === undefined || purchasedIds.has(id) ? [] : [id];
        }),
      ),
    ].sort();
    const playerIds = [
      ...teamPurchases.map((pick) => pick.playerId),
      ...unknownCostPlayerIds,
    ];
    return {
      rosterId: team.rosterId,
      name: team.name,
      remainingBudget:
        budget - teamPurchases.reduce((sum, pick) => sum + pick.amount, 0),
      openSlots: Math.max(0, config.rosterSize - playerIds.length),
      playerIds,
      ...(unknownCostPlayerIds.length > 0 ? { unknownCostPlayerIds } : {}),
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
    quarantinedPicks,
    warnings,
  };
}
