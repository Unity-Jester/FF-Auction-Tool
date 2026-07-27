import { NextResponse } from "next/server";

import {
  SleeperClient,
  SleeperError,
  type SleeperRequestOptions,
} from "@/integrations/sleeper/client";
import {
  requestClientKey,
  sleeperRateLimiter,
  type RateLimiter,
} from "@/integrations/sleeper/rate-limiter";
import {
  SleeperDraftSchema,
  type SleeperNflState,
  type SleeperUser,
} from "@/integrations/sleeper/schemas";
import { fixtureDiscoveredDrafts } from "@/testing/e2e-fixtures";

type Context = { params: Promise<{ username: string }> };
type DiscoveryClient = {
  getUser(
    username: string,
    options?: SleeperRequestOptions,
  ): Promise<SleeperUser>;
  getNflState(options?: SleeperRequestOptions): Promise<SleeperNflState>;
  getUserDrafts(
    userId: string,
    season: string,
    options?: SleeperRequestOptions,
  ): Promise<unknown[]>;
};

function errorResponse(error: unknown): NextResponse {
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

function publicDraftName(
  draft: ReturnType<typeof SleeperDraftSchema.parse>,
): string {
  const name = draft.metadata?.name;
  return typeof name === "string" &&
    name.trim().length > 0 &&
    name.trim().length <= 160
    ? name.trim()
    : `Auction ${String(draft.draft_id)}`;
}

export function createUserDraftsHandler(
  client: DiscoveryClient,
  limiter: RateLimiter = sleeperRateLimiter,
) {
  return async function GET(
    request: Request,
    context: Context,
  ): Promise<NextResponse> {
    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim();
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(username)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_USERNAME",
            message: "Invalid Sleeper username",
          },
        },
        { status: 400 },
      );
    }

    const fixtureDrafts = fixtureDiscoveredDrafts(username);
    if (fixtureDrafts) {
      return NextResponse.json(fixtureDrafts, {
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
      const [user, nflState] = await Promise.all([
        client.getUser(username, {
          next: { revalidate: 2 },
          signal: request.signal,
        }),
        client.getNflState({
          next: { revalidate: 300 },
          signal: request.signal,
        }),
      ]);
      const season = String(nflState.season);
      const drafts = await client.getUserDrafts(String(user.user_id), season, {
        next: { revalidate: 2 },
        signal: request.signal,
      });
      const validDrafts = [];
      for (const rawDraft of drafts) {
        const parsed = SleeperDraftSchema.safeParse(rawDraft);
        if (parsed.success) validDrafts.push(parsed.data);
      }
      return NextResponse.json({
        drafts: validDrafts
          .filter((draft) => draft.type === "auction")
          .map((draft) => ({
            draftId: String(draft.draft_id),
            leagueId: draft.league_id == null ? null : String(draft.league_id),
            name: publicDraftName(draft),
            status: draft.status,
            type: "auction" as const,
          })),
      });
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
export const GET = createUserDraftsHandler(client);
