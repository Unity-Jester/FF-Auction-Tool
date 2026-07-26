"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { LeagueReview } from "@/features/setup/components/league-review";
import { parseDraftApiResponse } from "@/features/draft-session/validate";
import { draftLoadMessage } from "@/features/connect/draft-load-message";
import { resolveLeagueConfig } from "@/persistence/league-storage";

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

export default function SetupPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = use(params);
  const query = useQuery({
    queryKey: ["setup-draft", draftId],
    queryFn: () => getDraft(draftId),
  });
  if (query.isPending)
    return (
      <section className="stage" aria-label="Draft setup">
        <p className="kicker">Connecting to Sleeper…</p>
      </section>
    );
  if (query.isError)
    return (
      <section className="stage" aria-label="Draft setup">
        <h1>We couldn’t open that auction.</h1>
        <p>{query.error.message}</p>
      </section>
    );
  return (
    <section className="stage" aria-label="Draft setup">
      <LeagueReview
        draftId={draftId}
        league={resolveLeagueConfig(draftId, query.data.league)}
        importedLeague={query.data.league}
      />
    </section>
  );
}
