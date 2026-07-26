export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type RateLimiter = {
  check(key: string): RateLimitDecision;
  readonly size: number;
};

type RateLimiterOptions = {
  limit?: number;
  windowMs?: number;
  maxEntries?: number;
  now?: () => number;
};

type WindowEntry = {
  count: number;
  resetAt: number;
};

export function createRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiter {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, WindowEntry>();

  if (limit <= 0 || windowMs <= 0 || maxEntries <= 0) {
    throw new Error("Rate limiter options must be positive");
  }

  function prune(currentTime: number): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) entries.delete(key);
    }
  }

  return {
    check(key: string): RateLimitDecision {
      const currentTime = now();
      prune(currentTime);
      const existing = entries.get(key);
      if (existing) {
        if (existing.count >= limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((existing.resetAt - currentTime) / 1_000),
            ),
          };
        }
        existing.count += 1;
        return { allowed: true };
      }

      while (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
      entries.set(key, { count: 1, resetAt: currentTime + windowMs });
      return { allowed: true };
    },
    get size() {
      return entries.size;
    },
  };
}

export function requestClientKey(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "global";
}

export const sleeperRateLimiter = createRateLimiter();
