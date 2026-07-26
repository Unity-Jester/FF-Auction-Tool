"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import type { DraftSnapshot } from "@/domain/draft/types";

export type DraftSyncStatus = "fresh" | "stale" | "offline";
export type DraftFetcher = (draftId: string) => Promise<DraftSnapshot>;

const validDraftId = (draftId: string | null | undefined) =>
  typeof draftId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(draftId);

async function fetchDraft(draftId: string): Promise<DraftSnapshot> {
  const response = await fetch(`/api/sleeper/drafts/${encodeURIComponent(draftId)}`);
  if (!response.ok) throw new Error("Unable to refresh Sleeper draft");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("snapshot" in body)) {
    throw new Error("Sleeper returned an invalid draft response");
  }
  return (body as { snapshot: DraftSnapshot }).snapshot;
}

function interval(snapshot: DraftSnapshot | undefined, failures: number) {
  if (failures > 0) return [5_000, 10_000, 30_000][Math.min(failures - 1, 2)];
  if (!snapshot) return 3_000;
  if (snapshot.status === "complete") return false;
  return snapshot.status === "pre" ? 30_000 : 3_000;
}

export function useDraftSync(
  draftId: string | null | undefined,
  request: DraftFetcher = fetchDraft,
) {
  const enabled = validDraftId(draftId);
  const failures = useRef({ draftId, count: 0 });
  const query = useQuery({
    queryKey: ["sleeper-draft", draftId],
    queryFn: async () => {
      if (failures.current.draftId !== draftId) {
        failures.current = { draftId, count: 0 };
      }
      try {
        const snapshot = await request(draftId as string);
        failures.current.count = 0;
        return snapshot;
      } catch (error) {
        failures.current.count += 1;
        throw error;
      }
    },
    enabled,
    retry: false,
    refetchInterval: (current) =>
      interval(
        current.state.data,
        failures.current.count,
      ),
    refetchIntervalInBackground: false,
  });
  const syncStatus: DraftSyncStatus = !enabled || (!query.data && query.isError)
    ? "offline"
    : query.isError
      ? "stale"
      : "fresh";

  return {
    data: query.data,
    syncStatus,
    lastUpdatedAt: query.data?.lastUpdatedAt ?? null,
    retry: query.refetch,
  };
}
