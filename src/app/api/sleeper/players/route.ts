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
import type { SleeperPlayerMap } from "@/integrations/sleeper/schemas";

type PlayerClient = {
  getPlayers(options?: SleeperRequestOptions): Promise<SleeperPlayerMap>;
};

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SleeperError) {
    const status = error.code === "RATE_LIMITED" ? 429 : 502;
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

export function createPlayersHandler(
  client: PlayerClient,
  limiter: RateLimiter = sleeperRateLimiter,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const rateLimit = limiter.check(requestClientKey(request));
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: { code: "RATE_LIMITED", message: "Too many Sleeper requests" },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 1) },
        },
      );
    }

    try {
      const playerMap = await client.getPlayers({
        next: { revalidate: 86_400 },
      });
      const players = Object.entries(playerMap)
        .filter(
          ([, player]) =>
            player.active !== false && player.status !== "Inactive",
        )
        .map(([key, player]) => ({
          playerId: String(player.player_id ?? key),
          fullName:
            player.full_name ??
            [player.first_name, player.last_name].filter(Boolean).join(" "),
          firstName: player.first_name,
          lastName: player.last_name,
          position: player.position ?? null,
          team: player.team ?? null,
        }))
        .sort((a, b) =>
          a.playerId.localeCompare(b.playerId, undefined, { numeric: true }),
        );
      return NextResponse.json({ players });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const client = new SleeperClient();
export const GET = createPlayersHandler(client);
