import { NextResponse } from "next/server";

import {
  SleeperClient,
  SleeperError,
  type SleeperRequestOptions,
} from "@/integrations/sleeper/client";
import type { SleeperDraft, SleeperNflState, SleeperUser } from "@/integrations/sleeper/schemas";

type Context = { params: Promise<{ username: string }> };
type DiscoveryClient = {
  getUser(username: string, options?: SleeperRequestOptions): Promise<SleeperUser>;
  getNflState(options?: SleeperRequestOptions): Promise<SleeperNflState>;
  getUserDrafts(
    userId: string,
    season: string,
    options?: SleeperRequestOptions,
  ): Promise<SleeperDraft[]>;
};

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SleeperError) {
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMITED" ? 429 : 502;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status },
    );
  }
  return NextResponse.json(
    { error: { code: "UPSTREAM", message: "Sleeper service unavailable" } },
    { status: 502 },
  );
}

export function createUserDraftsHandler(client: DiscoveryClient) {
  return async function GET(_request: Request, context: Context): Promise<NextResponse> {
    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim();
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(username)) {
      return NextResponse.json(
        { error: { code: "INVALID_USERNAME", message: "Invalid Sleeper username" } },
        { status: 400 },
      );
    }

    try {
      const [user, nflState] = await Promise.all([
        client.getUser(username, { next: { revalidate: 2 } }),
        client.getNflState({ next: { revalidate: 300 } }),
      ]);
      const season = String(nflState.season);
      const drafts = await client.getUserDrafts(String(user.user_id), season, {
        next: { revalidate: 2 },
      });
      return NextResponse.json({
        user: {
          userId: String(user.user_id),
          displayName: user.display_name ?? user.username ?? username,
        },
        season,
        drafts: drafts
          .filter((draft) => draft.type === "auction")
          .map((draft) => ({
            draftId: String(draft.draft_id),
            leagueId: draft.league_id == null ? null : String(draft.league_id),
            status: draft.status,
            settings: draft.settings,
            metadata: draft.metadata ?? {},
          })),
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const client = new SleeperClient();
export const GET = createUserDraftsHandler(client);
