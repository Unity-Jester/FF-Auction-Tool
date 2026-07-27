"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { StrategyBuilder } from "@/features/strategy/components/strategy-builder";
import { parseDraftApiResponse } from "@/features/draft-session/validate";
import { draftLoadMessage } from "@/features/connect/draft-load-message";
import { resolveLeagueConfig } from "@/persistence/league-storage";
import type { PlayerProjection } from "@/domain/players/types";
import type { ProjectionPlayer } from "@/integrations/projections/types";

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
  const players = useQuery({
    queryKey: ["strategy-players"],
    queryFn: async () => {
      const response = await fetch("/api/sleeper/players");
      if (!response.ok) throw new Error("Player identities are unavailable.");
      return ((await response.json()) as { players: ProjectionPlayer[] }).players;
    },
  });
  const projections = useQuery({
    queryKey: ["strategy-projections"],
    queryFn: async () => {
      const response = await fetch("/api/projections");
      if (!response.ok) throw new Error("Projections are unavailable.");
      return ((await response.json()) as { projections: PlayerProjection[] })
        .projections;
    },
  });
  if (query.isPending || players.isPending || projections.isPending)
    return (
      <section className="stage" aria-label="Draft strategy">
        <p className="kicker">Loading strategy…</p>
      </section>
    );
  if (query.isError || players.isError || projections.isError)
    return (
      <section className="stage" aria-label="Draft strategy">
        <h1>We couldn’t load this league.</h1>
        <p>
          {query.error?.message ??
            players.error?.message ??
            projections.error?.message}
        </p>
      </section>
    );
  return (
    <section className="stage" aria-label="Draft strategy">
      <StrategyBuilder
        draftId={draftId}
        league={resolveLeagueConfig(draftId, query.data.league)}
        players={players.data}
        projections={projections.data}
      />
    </section>
  );
}
