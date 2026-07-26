import { NextResponse } from "next/server";

import fallback from "../../../../data/projections/last-known.json";
import { createSleeperProjectionProvider } from "@/integrations/projections/sleeper-provider";
import type { ProjectionSnapshotData } from "@/integrations/projections/types";

const cacheControl = "public, s-maxage=21600, stale-while-revalidate=86400";

export function createProjectionsHandler(provider = createSleeperProjectionProvider({
  season: new Date().getUTCFullYear(),
  fallback: fallback as ProjectionSnapshotData,
})) {
  return async function GET(): Promise<NextResponse> {
    try {
      const snapshot = await provider.load();
      return NextResponse.json(snapshot, { headers: { "Cache-Control": cacheControl } });
    } catch {
      return NextResponse.json({ error: { code: "PROJECTIONS_UNAVAILABLE", message: "Projections are temporarily unavailable" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}

export const GET = createProjectionsHandler();
