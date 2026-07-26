import { afterEach, describe, expect, it, vi } from "vitest";

import { createFixtureControlHandler } from "@/app/api/e2e/fixtures/route";

describe("fixture control route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is unavailable in production even when the flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_FIXTURES", "1");

    const response = await createFixtureControlHandler()(
      new Request("http://localhost/api/e2e/fixtures?step=2"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets bounded fixture controls only in the explicit test mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_FIXTURES", "1");

    const response = await createFixtureControlHandler()(
      new Request(
        "http://localhost/api/e2e/fixtures?step=2&state=stale-projections",
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().join(";")).toContain(
      "sac-e2e-step=2",
    );
    expect(response.headers.getSetCookie().join(";")).toContain(
      "sac-e2e-state=stale-projections",
    );
  });

  it("rejects malformed controls without setting cookies", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_FIXTURES", "1");

    const response = await createFixtureControlHandler()(
      new Request("http://localhost/api/e2e/fixtures?step=wat&state=secret"),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
