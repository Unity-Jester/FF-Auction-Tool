import { NextResponse } from "next/server";

import {
  SleeperClient,
  SleeperError,
  type SleeperRequestOptions,
} from "@/integrations/sleeper/client";
import {
  normalizeDraft,
  UnsupportedDraftTypeError,
  type NormalizedDraft,
} from "@/integrations/sleeper/normalize-draft";
import { parseDraftReference } from "@/integrations/sleeper/parse-draft-reference";
import {
  requestClientKey,
  sleeperRateLimiter,
  type RateLimiter,
} from "@/integrations/sleeper/rate-limiter";
import type {
  SleeperDraft,
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
} from "@/integrations/sleeper/schemas";
import {
  E2E_SNAKE_DRAFT_ID,
  fixtureDraftResponse,
  fixtureModeEnabled,
  fixtureStateFromRequest,
} from "@/testing/e2e-fixtures";

type Context = { params: Promise<{ draftId: string }> };
type DetailClient = {
  getDraft(
    draftId: string,
    options?: SleeperRequestOptions,
  ): Promise<SleeperDraft>;
  getDraftPicks(
    draftId: string,
    options?: SleeperRequestOptions,
  ): Promise<unknown[]>;
  getLeague(
    leagueId: string,
    options?: SleeperRequestOptions,
  ): Promise<SleeperLeague>;
  getLeagueUsers(
    leagueId: string,
    options?: SleeperRequestOptions,
  ): Promise<SleeperUser[]>;
  getLeagueRosters(
    leagueId: string,
    options?: SleeperRequestOptions,
  ): Promise<SleeperRoster[]>;
};

function publicDraftResponse(draft: NormalizedDraft) {
  return {
    snapshot: draft.snapshot,
    warnings: draft.warnings,
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UnsupportedDraftTypeError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 422 },
    );
  }
  if (error instanceof SleeperError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "RATE_LIMITED"
          ? 429
          : 502;
    const headers =
      error.code === "RATE_LIMITED" && error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status, headers },
    );
  }
  return NextResponse.json(
    { error: { code: "UPSTREAM", message: "Sleeper service unavailable" } },
    { status: 502 },
  );
}

export function createDraftHandler(
  client: DetailClient,
  limiter: RateLimiter = sleeperRateLimiter,
) {
  return async function GET(
    request: Request,
    context: Context,
  ): Promise<NextResponse> {
    let draftId: string;
    try {
      draftId = parseDraftReference((await context.params).draftId);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_DRAFT", message: "Invalid Sleeper draft" } },
        { status: 400 },
      );
    }

    if (fixtureModeEnabled() && draftId === E2E_SNAKE_DRAFT_ID) {
      return NextResponse.json(
        {
          error: {
            code: "UNSUPPORTED_DRAFT_TYPE",
            message: "Snake drafts are not supported",
          },
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    const fixtureResponse = fixtureDraftResponse(request, draftId);
    if (fixtureResponse) {
      if (fixtureStateFromRequest(request) === "offline") {
        return NextResponse.json(
          {
            error: {
              code: "UPSTREAM",
              message: "Recorded fixture is temporarily offline",
            },
          },
          { status: 502 },
        );
      }
      return NextResponse.json(publicDraftResponse(fixtureResponse), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const rateLimit = await limiter.check(
      requestClientKey(request),
      request.signal,
    );
    if (rateLimit.storeUnavailable) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMIT_UNAVAILABLE",
            message: "Request protection unavailable",
          },
        },
        { status: 503 },
      );
    }
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Sleeper rate limit reached",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 1) },
        },
      );
    }

    try {
      const activeCache = {
        next: { revalidate: 2 },
        signal: request.signal,
      } as const;
      const [draft, picks] = await Promise.all([
        client.getDraft(draftId, activeCache),
        client.getDraftPicks(draftId, activeCache),
      ]);
      let league: SleeperLeague | undefined;
      let users: SleeperUser[] = [];
      let rosters: SleeperRoster[] = [];
      if (draft.league_id != null) {
        const leagueId = String(draft.league_id);
        [league, users, rosters] = await Promise.all([
          client.getLeague(leagueId, {
            next: { revalidate: 300 },
            signal: request.signal,
          }),
          client.getLeagueUsers(leagueId, {
            next: { revalidate: 300 },
            signal: request.signal,
          }),
          client.getLeagueRosters(leagueId, {
            next: { revalidate: 300 },
            signal: request.signal,
          }),
        ]);
      }
      return NextResponse.json(
        publicDraftResponse(
          normalizeDraft({ draft, picks, league, users, rosters }),
        ),
        {
          headers: {
            "Cache-Control": "public, s-maxage=1, stale-while-revalidate=2",
          },
        },
      );
    } catch (error) {
      if (
        error instanceof SleeperError &&
        error.code === "RATE_LIMITED" &&
        error.retryAfterSeconds
      ) {
        await limiter.blockFor(error.retryAfterSeconds, request.signal);
      }
      return errorResponse(error);
    }
  };
}

const client = new SleeperClient();
export const GET = createDraftHandler(client);
