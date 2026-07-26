import { z } from "zod";

import {
  SleeperDraftSchema,
  SleeperLeagueSchema,
  SleeperNflStateSchema,
  SleeperPlayerMapSchema,
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

type FetchFn = (
  input: string,
  init?: SleeperRequestOptions,
) => Promise<Response>;

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
  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl = "https://api.sleeper.app/v1",
  ) {}

  private async request<T extends z.ZodType>(
    path: string,
    schema: T,
    options: SleeperRequestOptions = {},
  ): Promise<z.infer<T>> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...options,
        method: "GET",
      });
    } catch {
      throw new SleeperError("UPSTREAM");
    }

    if (!response.ok) {
      if (response.status === 404) throw new SleeperError("NOT_FOUND");
      if (response.status === 429) {
        throw new SleeperError("RATE_LIMITED", boundedRetryAfter(response));
      }
      throw new SleeperError("UPSTREAM");
    }

    try {
      return schema.parse(await response.json());
    } catch {
      throw new SleeperError("MALFORMED");
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

  getPlayers(options?: SleeperRequestOptions) {
    return this.request("/players/nfl", SleeperPlayerMapSchema, options);
  }
}
