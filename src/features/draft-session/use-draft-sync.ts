"use client";

import { useQuery } from "@tanstack/react-query";

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
  if (!snapshot) return 3_000;
  if (snapshot.status === "complete") return false;
  if (failures > 0) return [5_000, 10_000, 30_000][Math.min(failures - 1, 2)];
  return snapshot.status === "pre" ? 30_000 : 3_000;
}

export function useDraftSync(
  draftId: string | null | undefined,
  request: DraftFetcher = fetchDraft,
) {
  const enabled = validDraftId(draftId);
  const query = useQuery({
    queryKey: ["sleeper-draft", draftId],
    queryFn: () => request(draftId as string),
    enabled,
    retry: false,
    refetchInterval: (current) =>
      interval(
        current.state.data,
        current.state.fetchFailureCount,
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
