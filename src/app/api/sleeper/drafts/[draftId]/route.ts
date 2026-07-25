import { NextResponse } from "next/server";

import {
  SleeperClient,
  SleeperError,
  type SleeperRequestOptions,
} from "@/integrations/sleeper/client";
import { normalizeDraft, UnsupportedDraftTypeError } from "@/integrations/sleeper/normalize-draft";
import { parseDraftReference } from "@/integrations/sleeper/parse-draft-reference";
import type {
  SleeperDraft,
  SleeperLeague,
  SleeperPick,
  SleeperPlayerMap,
  SleeperRoster,
  SleeperUser,
} from "@/integrations/sleeper/schemas";

type Context = { params: Promise<{ draftId: string }> };
type DetailClient = {
  getDraft(draftId: string, options?: SleeperRequestOptions): Promise<SleeperDraft>;
  getDraftPicks(draftId: string, options?: SleeperRequestOptions): Promise<SleeperPick[]>;
  getLeague(leagueId: string, options?: SleeperRequestOptions): Promise<SleeperLeague>;
  getLeagueUsers(leagueId: string, options?: SleeperRequestOptions): Promise<SleeperUser[]>;
  getLeagueRosters(leagueId: string, options?: SleeperRequestOptions): Promise<SleeperRoster[]>;
  getPlayers(options?: SleeperRequestOptions): Promise<SleeperPlayerMap>;
};

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UnsupportedDraftTypeError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 422 },
    );
  }
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

export function createDraftHandler(client: DetailClient) {
  return async function GET(_request: Request, context: Context): Promise<NextResponse> {
    let draftId: string;
    try {
      draftId = parseDraftReference((await context.params).draftId);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_DRAFT", message: "Invalid Sleeper draft" } },
        { status: 400 },
      );
    }

    try {
      const activeCache = { next: { revalidate: 2 } } as const;
      const [draft, picks, players] = await Promise.all([
        client.getDraft(draftId, activeCache),
        client.getDraftPicks(draftId, activeCache),
        client.getPlayers({ next: { revalidate: 86_400 } }),
      ]);
      let league: SleeperLeague | undefined;
      let users: SleeperUser[] = [];
      let rosters: SleeperRoster[] = [];
      if (draft.league_id != null) {
        const leagueId = String(draft.league_id);
        [league, users, rosters] = await Promise.all([
          client.getLeague(leagueId, { next: { revalidate: 300 } }),
          client.getLeagueUsers(leagueId, { next: { revalidate: 300 } }),
          client.getLeagueRosters(leagueId, { next: { revalidate: 300 } }),
        ]);
      }
      return NextResponse.json(
        normalizeDraft({ draft, picks, league, users, rosters, players }),
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const client = new SleeperClient();
export const GET = createDraftHandler(client);

