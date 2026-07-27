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

function matchesEtag(header: string | null): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const validator = candidate.trim();
    if (validator === "*") return true;
    return validator.replace(/^W\//i, "") === etag;
  });
}

export function createPlayersHandler(
  limiter: RateLimiter = sleeperRateLimiter,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const rateLimit = await limiter.check(
      requestClientKey(request),
      request.signal,
    );
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
    if (matchesEtag(request.headers.get("if-none-match"))) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(serializedSnapshot, {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  };
}

export const GET = createPlayersHandler();
