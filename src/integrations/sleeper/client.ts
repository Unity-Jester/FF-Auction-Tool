import { z } from "zod";

import {
  SleeperDraftSchema,
  SleeperLeagueSchema,
  SleeperNflStateSchema,
  SleeperRawDraftsSchema,
  SleeperRawPicksSchema,
  SleeperRostersSchema,
  SleeperUserSchema,
  SleeperUsersSchema,
} from "./schemas";

export type SleeperErrorCode =
  "NOT_FOUND" | "RATE_LIMITED" | "UPSTREAM" | "MALFORMED";

const messages: Record<SleeperErrorCode, string> = {
  NOT_FOUND: "Sleeper resource not found",
  RATE_LIMITED: "Sleeper rate limit reached",
  UPSTREAM: "Sleeper service unavailable",
  MALFORMED: "Sleeper returned malformed data",
};

export class SleeperError extends Error {
  constructor(
    public readonly code: SleeperErrorCode,
    public readonly retryAfterSeconds?: number,
  ) {
    super(messages[code]);
    this.name = "SleeperError";
  }
}

export type SleeperRequestOptions = RequestInit & {
  next?: { revalidate?: number };
};

export const DEFAULT_SLEEPER_TIMEOUT_MS = 12_000;
export const MAX_SLEEPER_RESPONSE_BYTES = 2 * 1024 * 1024;

type FetchFn = (
  input: string,
  init?: SleeperRequestOptions,
) => Promise<Response>;

type SleeperClientOptions = {
  timeoutMs?: number;
  maxResponseBytes?: number;
};

function boundedRetryAfter(response: Response): number {
  const value = response.headers.get("Retry-After");
  const seconds = Number(value);
  if (Number.isFinite(seconds))
    return Math.min(300, Math.max(1, Math.ceil(seconds)));
  if (value) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return Math.min(
        300,
        Math.max(1, Math.ceil((timestamp - Date.now()) / 1_000)),
      );
    }
  }
  return 5;
}

export class SleeperClient {
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl = "https://api.sleeper.app/v1",
    options: SleeperClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SLEEPER_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? MAX_SLEEPER_RESPONSE_BYTES;
    if (this.timeoutMs <= 0 || this.maxResponseBytes <= 0) {
      throw new Error("Sleeper request limits must be positive");
    }
  }

  private async readBoundedJson(response: Response): Promise<unknown> {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const bytes = Number(declaredLength);
      if (
        Number.isFinite(bytes) &&
        bytes >= 0 &&
        bytes > this.maxResponseBytes
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Sleeper response exceeds the byte limit");
      }
    }
    if (!response.body) throw new Error("Sleeper response has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Sleeper response exceeds the byte limit");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  private async request<T extends z.ZodType>(
    path: string,
    schema: T,
    options: SleeperRequestOptions = {},
  ): Promise<z.infer<T>> {
    const {
      signal: callerSignal,
      ...requestOptions
    } = options;
    const controller = new AbortController();
    const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) forwardCallerAbort();
    else {
      callerSignal?.addEventListener("abort", forwardCallerAbort, {
        once: true,
      });
    }
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Timed out", "TimeoutError")),
      this.timeoutMs,
    );
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...requestOptions,
        method: "GET",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", forwardCallerAbort);
      throw new SleeperError("UPSTREAM");
    }

    try {
      if (!response.ok) {
        if (response.status === 404) throw new SleeperError("NOT_FOUND");
        if (response.status === 429) {
          throw new SleeperError("RATE_LIMITED", boundedRetryAfter(response));
        }
        throw new SleeperError("UPSTREAM");
      }

      try {
        return schema.parse(await this.readBoundedJson(response));
      } catch {
        throw new SleeperError(
          controller.signal.aborted ? "UPSTREAM" : "MALFORMED",
        );
      }
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", forwardCallerAbort);
    }
  }

  async getUser(username: string, options?: SleeperRequestOptions) {
    const user = await this.request(
      `/user/${encodeURIComponent(username)}`,
      SleeperUserSchema.nullable(),
      options,
    );
    if (user === null) throw new SleeperError("NOT_FOUND");
    return user;
  }

  getNflState(options?: SleeperRequestOptions) {
    return this.request("/state/nfl", SleeperNflStateSchema, options);
  }

  getUserDrafts(
    userId: string,
    season: string,
    options?: SleeperRequestOptions,
  ) {
    return this.request(
      `/user/${encodeURIComponent(userId)}/drafts/nfl/${encodeURIComponent(season)}`,
      SleeperRawDraftsSchema,
      options,
    );
  }

  getDraft(draftId: string, options?: SleeperRequestOptions) {
    return this.request(
      `/draft/${encodeURIComponent(draftId)}`,
      SleeperDraftSchema,
      options,
    );
  }

  getDraftPicks(draftId: string, options?: SleeperRequestOptions) {
    return this.request(
      `/draft/${encodeURIComponent(draftId)}/picks`,
      SleeperRawPicksSchema,
      options,
    );
  }

  getLeague(leagueId: string, options?: SleeperRequestOptions) {
    return this.request(
      `/league/${encodeURIComponent(leagueId)}`,
      SleeperLeagueSchema,
      options,
    );
  }

  getLeagueUsers(leagueId: string, options?: SleeperRequestOptions) {
    return this.request(
      `/league/${encodeURIComponent(leagueId)}/users`,
      SleeperUsersSchema,
      options,
    );
  }

  getLeagueRosters(leagueId: string, options?: SleeperRequestOptions) {
    return this.request(
      `/league/${encodeURIComponent(leagueId)}/rosters`,
      SleeperRostersSchema,
      options,
    );
  }
}
