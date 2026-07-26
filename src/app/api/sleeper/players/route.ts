import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import {
  requestClientKey,
  sleeperRateLimiter,
  type RateLimiter,
} from "@/integrations/sleeper/rate-limiter";
import playerSnapshot from "../../../../../data/sleeper/players.json";

const cacheControl = "public, s-maxage=86400, stale-while-revalidate=86400";
const serializedSnapshot = JSON.stringify({ players: playerSnapshot });
const etag = `"${createHash("sha256").update(serializedSnapshot).digest("hex")}"`;

export function createPlayersHandler(
  limiter: RateLimiter = sleeperRateLimiter,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const rateLimit = await limiter.check(requestClientKey(request));
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
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds ?? 1),
          },
        },
      );
    }

    const headers = { "Cache-Control": cacheControl, ETag: etag };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(serializedSnapshot, {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  };
}

export const GET = createPlayersHandler();
