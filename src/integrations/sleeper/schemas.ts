import { z } from "zod";

const identifier = z.union([z.string().min(1), z.number().int().nonnegative()]);
const nullableIdentifier = identifier.nullable();
const settings = z.record(z.string(), z.unknown());

export const SleeperUserSchema = z
  .object({
    user_id: identifier,
    display_name: z.string().optional(),
    username: z.string().optional(),
    metadata: settings.optional(),
  })
  .passthrough();

export const SleeperNflStateSchema = z
  .object({
    season: z.union([z.string().min(4), z.number().int().positive()]),
    season_type: z.string().optional(),
    week: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const SleeperDraftSchema = z
  .object({
    draft_id: identifier,
    league_id: nullableIdentifier.optional(),
    type: z.string().min(1),
    status: z.string().min(1),
    settings,
    metadata: settings.optional(),
    slot_to_roster_id: z.record(z.string(), identifier).optional(),
    draft_order: z.record(z.string(), z.number().int().positive()).optional(),
  })
  .passthrough();

export const SleeperPickSchema = z
  .object({
    draft_id: identifier,
    player_id: identifier,
    roster_id: z.number().int().positive(),
    pick_no: z.number().int().positive(),
    metadata: settings,
  })
  .passthrough();

export const SleeperLeagueSchema = z
  .object({
    league_id: identifier,
    total_rosters: z.number().int().positive(),
    roster_positions: z.array(z.string()),
    scoring_settings: settings,
    settings,
  })
  .passthrough();

export const SleeperRosterSchema = z
  .object({
    roster_id: z.number().int().positive(),
    owner_id: nullableIdentifier.optional(),
    players: z.array(identifier).nullable().optional(),
    settings: settings.optional(),
    metadata: settings.optional(),
  })
  .passthrough();

export const SleeperPlayerSchema = z
  .object({
    player_id: identifier.optional(),
    full_name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    position: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
  })
  .passthrough();

export const SleeperDraftsSchema = z.array(SleeperDraftSchema);
export const SleeperPicksSchema = z.array(SleeperPickSchema);
export const SleeperUsersSchema = z.array(SleeperUserSchema);
export const SleeperRostersSchema = z.array(SleeperRosterSchema);
export const SleeperPlayerMapSchema = z.record(z.string(), SleeperPlayerSchema);

export type SleeperUser = z.infer<typeof SleeperUserSchema>;
export type SleeperNflState = z.infer<typeof SleeperNflStateSchema>;
export type SleeperDraft = z.infer<typeof SleeperDraftSchema>;
export type SleeperPick = z.infer<typeof SleeperPickSchema>;
export type SleeperLeague = z.infer<typeof SleeperLeagueSchema>;
export type SleeperRoster = z.infer<typeof SleeperRosterSchema>;
export type SleeperPlayerMap = z.infer<typeof SleeperPlayerMapSchema>;

