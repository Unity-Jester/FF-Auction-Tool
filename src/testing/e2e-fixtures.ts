import mockDraft from "../../tests/fixtures/sleeper/mock-draft.json";
import pickSequence from "../../tests/fixtures/sleeper/mock-picks-sequence.json";

import { normalizeDraft } from "@/integrations/sleeper/normalize-draft";
import {
  SleeperDraftSchema,
  type SleeperDraft,
} from "@/integrations/sleeper/schemas";
import type {
  ProjectionSnapshot,
  ProjectionSnapshotData,
} from "@/integrations/projections/types";

type FixtureEnvironment = Record<string, string | undefined>;

export const E2E_DRAFT_ID = "1234567890";
export const E2E_REAL_DRAFT_ID = "9876543210";
export const E2E_SNAKE_DRAFT_ID = "9999999999";
export const E2E_USERNAME = "auction_guest";
export const E2E_STEP_COOKIE = "sac-e2e-step";
export const E2E_STATE_COOKIE = "sac-e2e-state";
export const E2E_MAX_STEP = pickSequence.length;

export function fixtureModeEnabled(
  environment: FixtureEnvironment = process.env,
): boolean {
  return (
    environment.E2E_FIXTURES === "1" &&
    environment.NODE_ENV !== "production"
  );
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const entry of cookie.split(";")) {
    const [candidate, ...value] = entry.trim().split("=");
    if (candidate === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function fixtureStepFromRequest(
  request: Request,
  environment: FixtureEnvironment = process.env,
): number | null {
  if (!fixtureModeEnabled(environment)) return null;
  const parsed = Number(cookieValue(request, E2E_STEP_COOKIE) ?? "0");
  if (!Number.isSafeInteger(parsed)) return 0;
  return Math.max(0, Math.min(E2E_MAX_STEP, parsed));
}

export function fixtureStateFromRequest(
  request: Request,
  environment: FixtureEnvironment = process.env,
): "online" | "offline" | "stale-projections" | null {
  if (!fixtureModeEnabled(environment)) return null;
  const state = cookieValue(request, E2E_STATE_COOKIE);
  return state === "offline" || state === "stale-projections"
    ? state
    : "online";
}

function draftForId(draftId: string): SleeperDraft {
  const parsed = SleeperDraftSchema.parse({
    ...mockDraft,
    draft_id: draftId,
    league_id: draftId === E2E_REAL_DRAFT_ID ? "fixture-league" : null,
  });
  return parsed;
}

export function fixtureDraftResponse(request: Request, draftId: string) {
  const step = fixtureStepFromRequest(request);
  if (step === null) return null;
  if (draftId !== E2E_DRAFT_ID && draftId !== E2E_REAL_DRAFT_ID) return null;
  const picks = pickSequence.slice(0, step).map((pick) => ({
    ...pick,
    draft_id: draftId,
  }));
  return normalizeDraft({
    draft: draftForId(draftId),
    picks,
    now: new Date(`2026-07-25T18:00:0${step}.000Z`),
  });
}

export function fixtureDiscoveredDrafts(username: string) {
  if (!fixtureModeEnabled() || username !== E2E_USERNAME) return null;
  return {
    user: { userId: "fixture-user", displayName: "Auction Guest" },
    season: "2026",
    drafts: [
      {
        draftId: E2E_REAL_DRAFT_ID,
        leagueId: "fixture-league",
        status: "drafting",
        settings: mockDraft.settings,
        metadata: { name: "Recorded league auction" },
      },
      {
        draftId: E2E_DRAFT_ID,
        leagueId: null,
        status: "drafting",
        settings: mockDraft.settings,
        metadata: { name: "Recorded mock auction" },
      },
    ],
    quarantinedDrafts: [],
  };
}

export function fixtureProjectionSnapshot(
  request: Request,
  fallback: ProjectionSnapshotData,
): ProjectionSnapshot | null {
  const state = fixtureStateFromRequest(request);
  if (state === null) return null;
  const updatedAt = "2026-07-25T17:45:00.000Z";
  return {
    source: "Recorded fixture projections",
    updatedAt,
    stale: state === "stale-projections",
    projections: fallback.projections.map((projection) => ({
      ...projection,
      source: "Recorded fixture projections",
      updatedAt,
    })),
  };
}
