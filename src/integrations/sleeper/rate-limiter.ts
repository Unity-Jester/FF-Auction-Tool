import { isIP } from "node:net";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type RateLimitIncrement = {
  count: number;
  retryAfterSeconds: number;
};

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitIncrement>;
  getBlockedUntil(): Promise<number | null>;
  setBlockedUntil(timestamp: number, ttlMs: number): Promise<void>;
  readonly size?: number;
}

export type RateLimiter = {
  check(key: string): Promise<RateLimitDecision>;
  blockFor(retryAfterSeconds: number): Promise<void>;
  readonly size: number;
};

type InMemoryStoreOptions = {
  maxEntries?: number;
  now?: () => number;
};

type WindowEntry = {
  count: number;
  resetAt: number;
};

/**
 * Best-effort fallback for local development and single-instance deployments.
 * Configure Upstash REST variables in production when counters must be shared.
 */
export function createInMemoryRateLimitStore(
  options: InMemoryStoreOptions = {},
): RateLimitStore {
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, WindowEntry>();
  let blockedUntil = 0;
  if (maxEntries <= 0)
    throw new Error("Rate limiter max entries must be positive");

  function prune(currentTime: number): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) entries.delete(key);
    }
  }

  return {
    async increment(
      key: string,
      windowMs: number,
    ): Promise<RateLimitIncrement> {
      const currentTime = now();
      prune(currentTime);
      const existing = entries.get(key);
      if (existing) {
        existing.count += 1;
        return {
          count: existing.count,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.resetAt - currentTime) / 1_000),
          ),
        };
      }
      while (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
      entries.set(key, { count: 1, resetAt: currentTime + windowMs });
      return {
        count: 1,
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1_000)),
      };
    },
    async getBlockedUntil(): Promise<number | null> {
      if (blockedUntil <= now()) {
        blockedUntil = 0;
        return null;
      }
      return blockedUntil;
    },
    async setBlockedUntil(timestamp: number): Promise<void> {
      blockedUntil = Math.max(blockedUntil, timestamp);
    },
    get size() {
      prune(now());
      return entries.size;
    },
  };
}

type RestFetch = (input: string, init?: RequestInit) => Promise<Response>;
type UpstashOptions = {
  url: string;
  token: string;
  fetchFn?: RestFetch;
};

const incrementScript =
  "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; local ttl=redis.call('PTTL',KEYS[1]); return {count,ttl}";
const blockScript =
  "local current=tonumber(redis.call('GET',KEYS[1]) or '0'); local requested=tonumber(ARGV[1]); if requested>current then redis.call('SET',KEYS[1],requested,'PX',ARGV[2]); return requested end; return current";

export function createUpstashRateLimitStore(
  options: UpstashOptions,
): RateLimitStore {
  const url = options.url.replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? fetch;
  if (!url || !options.token)
    throw new Error("Upstash URL and token are required");

  async function command<T>(body: unknown[]): Promise<T> {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Shared rate-limit store unavailable");
    const payload = (await response.json()) as { result?: T; error?: string };
    if (payload.error || payload.result === undefined) {
      throw new Error("Shared rate-limit store returned malformed data");
    }
    return payload.result;
  }

  return {
    async increment(
      key: string,
      windowMs: number,
    ): Promise<RateLimitIncrement> {
      const result = await command<[number, number]>([
        "EVAL",
        incrementScript,
        "1",
        `sleeper:rate:${key}`,
        String(windowMs),
      ]);
      const count = Number(result[0]);
      const ttlMs = Number(result[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
        throw new Error("Shared rate-limit store returned malformed data");
      }
      return {
        count,
        retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
      };
    },
    async getBlockedUntil(): Promise<number | null> {
      const result = await command<string | null>([
        "GET",
        "sleeper:blocked-until",
      ]);
      if (result === null) return null;
      const timestamp = Number(result);
      return Number.isFinite(timestamp) ? timestamp : null;
    },
    async setBlockedUntil(timestamp: number, ttlMs: number): Promise<void> {
      await command<number>([
        "EVAL",
        blockScript,
        "1",
        "sleeper:blocked-until",
        String(timestamp),
        String(ttlMs),
      ]);
    },
  };
}

type RateLimiterOptions = {
  limit?: number;
  windowMs?: number;
  store?: RateLimitStore;
  now?: () => number;
};

export function createRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiter {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const store = options.store ?? createInMemoryRateLimitStore({ now });
  if (limit <= 0 || windowMs <= 0) {
    throw new Error("Rate limiter options must be positive");
  }

  return {
    async check(key: string): Promise<RateLimitDecision> {
      const currentTime = now();
      const blockedUntil = await store.getBlockedUntil();
      if (blockedUntil !== null && blockedUntil > currentTime) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((blockedUntil - currentTime) / 1_000),
          ),
        };
      }
      const increment = await store.increment(key, windowMs);
      if (increment.count > limit) {
        return {
          allowed: false,
          retryAfterSeconds: increment.retryAfterSeconds,
        };
      }
      return { allowed: true };
    },
    async blockFor(retryAfterSeconds: number): Promise<void> {
      const boundedSeconds = Math.min(
        300,
        Math.max(1, Math.ceil(retryAfterSeconds)),
      );
      await store.setBlockedUntil(
        now() + boundedSeconds * 1_000,
        boundedSeconds * 1_000,
      );
    },
    get size() {
      return store.size ?? 0;
    },
  };
}

function cleanIp(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  if (!first || first.length > 64 || isIP(first) === 0) return null;
  return first;
}

export function requestClientKey(
  request: Request,
  options: { trustProxy?: boolean } = {},
): string {
  const platformIp =
    cleanIp(request.headers.get("cf-connecting-ip")) ??
    cleanIp(request.headers.get("x-vercel-forwarded-for"));
  if (platformIp) return platformIp;
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const forwarded = cleanIp(request.headers.get("x-forwarded-for"));
    if (forwarded) return forwarded;
  }
  return "global";
}

function defaultStore(): RateLimitStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token
    ? createUpstashRateLimitStore({ url, token })
    : createInMemoryRateLimitStore();
}

export const sleeperRateLimiter = createRateLimiter({ store: defaultStore() });
