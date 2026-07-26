"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import type { DraftSnapshot } from "@/domain/draft/types";
import { reconcileDraft } from "./reconcile";
import { parseDraftApiResponse, parseDraftSnapshot } from "./validate";

export type DraftSyncStatus = "fresh" | "stale" | "offline";
export type DraftFetcher = (
  draftId: string,
  signal?: AbortSignal,
) => Promise<unknown>;
type SyncedDraft = {
  snapshot: DraftSnapshot;
  lastUpdatedAt: string;
};

function isSyncedDraft(value: unknown): value is SyncedDraft {
  return (
    !!value &&
    typeof value === "object" &&
    "snapshot" in value &&
    "lastUpdatedAt" in value &&
    typeof value.lastUpdatedAt === "string"
  );
}

function shareSyncedDraft(previous: unknown, next: unknown): unknown {
  if (!isSyncedDraft(next) || !isSyncedDraft(previous)) return next;
  const snapshot = reconcileDraft(
    { snapshot: previous.snapshot, localCorrections: [] },
    next.snapshot,
  ).snapshot;
  return snapshot === previous.snapshot &&
    next.lastUpdatedAt === previous.lastUpdatedAt
    ? previous
    : { snapshot, lastUpdatedAt: next.lastUpdatedAt };
}

const validDraftId = (draftId: string | null | undefined) =>
  typeof draftId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(draftId);

async function fetchDraft(
  draftId: string,
  signal?: AbortSignal,
): Promise<DraftSnapshot> {
  const response = await fetch(
    `/api/sleeper/drafts/${encodeURIComponent(draftId)}`,
    { signal },
  );
  const payload = await response.json();
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Unable to refresh Sleeper draft";
    throw new Error(message);
  }
  return parseDraftApiResponse(payload, draftId);
}

function interval(snapshot: DraftSnapshot | undefined, failures: number) {
  if (snapshot?.status === "complete") return false;
  if (failures > 0) return [5_000, 10_000, 30_000][Math.min(failures - 1, 2)];
  if (!snapshot) return 3_000;
  return snapshot.status === "pre" ? 30_000 : 3_000;
}

export function useDraftSync(
  draftId: string | null | undefined,
  request: DraftFetcher = fetchDraft,
) {
  const enabled = validDraftId(draftId);
  const failures = useRef(new Map<string, number>());
  const query = useQuery<SyncedDraft>({
    queryKey: ["sleeper-draft", draftId],
    queryFn: async ({ signal }) => {
      const requestedDraftId = draftId as string;
      try {
        const snapshot = parseDraftSnapshot(
          await request(requestedDraftId, signal),
          requestedDraftId,
        );
        failures.current.set(requestedDraftId, 0);
        return { snapshot, lastUpdatedAt: snapshot.lastUpdatedAt };
      } catch (error) {
        failures.current.set(
          requestedDraftId,
          (failures.current.get(requestedDraftId) ?? 0) + 1,
        );
        throw error;
      }
    },
    enabled,
    retry: false,
    refetchInterval: (current) =>
      interval(
        current.state.data?.snapshot,
        failures.current.get(draftId as string) ?? 0,
      ),
    refetchIntervalInBackground: false,
    structuralSharing: shareSyncedDraft,
  });
  const syncStatus: DraftSyncStatus = !enabled || (!query.data && query.isError)
    ? "offline"
    : query.isError
      ? "stale"
      : "fresh";

  return {
    data: query.data?.snapshot,
    syncStatus,
    lastUpdatedAt: query.data?.lastUpdatedAt ?? null,
    retry: query.refetch,
    error: query.error,
  };
}
