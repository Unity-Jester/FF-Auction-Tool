"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { StrategyBuilder } from "@/features/strategy/components/strategy-builder";
import { parseDraftApiResponse } from "@/features/draft-session/validate";
import { draftLoadMessage } from "@/features/connect/draft-load-message";

async function getDraft(draftId: string) {
  const response = await fetch(
    `/api/sleeper/drafts/${encodeURIComponent(draftId)}`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(draftLoadMessage(payload?.error?.code));
  }
  return parseDraftApiResponse(await response.json(), draftId);
}
export default function StrategyPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = use(params);
  const query = useQuery({
    queryKey: ["strategy-draft", draftId],
    queryFn: () => getDraft(draftId),
  });
  if (query.isPending)
    return (
      <main className="stage">
        <p className="kicker">Loading strategy…</p>
      </main>
    );
  if (query.isError)
    return (
      <main className="stage">
        <h1>We couldn’t load this league.</h1>
        <p>{query.error.message}</p>
      </main>
    );
  return (
    <main className="stage">
      <StrategyBuilder draftId={draftId} league={query.data.league} />
    </main>
  );
}
