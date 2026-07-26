import { NextResponse } from "next/server";

import {
  E2E_MAX_STEP,
  E2E_STATE_COOKIE,
  E2E_STEP_COOKIE,
  fixtureModeEnabled,
} from "@/testing/e2e-fixtures";

const allowedStates = new Set(["online", "offline", "stale-projections"]);

export function createFixtureControlHandler() {
  return async function GET(request: Request): Promise<NextResponse> {
    if (!fixtureModeEnabled()) {
      return new NextResponse(null, { status: 404 });
    }
    const url = new URL(request.url);
    const step = Number(url.searchParams.get("step") ?? "0");
    const state = url.searchParams.get("state") ?? "online";
    if (
      !Number.isSafeInteger(step) ||
      step < 0 ||
      step > E2E_MAX_STEP ||
      !allowedStates.has(state)
    ) {
      return NextResponse.json(
        { error: { code: "INVALID_FIXTURE_CONTROL" } },
        { status: 400 },
      );
    }
    const response = new NextResponse(null, { status: 204 });
    const cookieOptions = {
      httpOnly: true,
      sameSite: "strict" as const,
      path: "/",
      maxAge: 60 * 60,
    };
    response.cookies.set(E2E_STEP_COOKIE, String(step), cookieOptions);
    response.cookies.set(E2E_STATE_COOKIE, state, cookieOptions);
    return response;
  };
}

export const GET = createFixtureControlHandler();
