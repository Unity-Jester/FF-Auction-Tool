import { describe, expect, it } from "vitest";

import {
  fixtureModeEnabled,
  fixtureStepFromRequest,
} from "@/testing/e2e-fixtures";

describe("E2E fixture isolation", () => {
  it("requires the explicit flag outside production", () => {
    expect(fixtureModeEnabled({ E2E_FIXTURES: "1", NODE_ENV: "test" })).toBe(
      true,
    );
    expect(
      fixtureModeEnabled({ E2E_FIXTURES: "1", NODE_ENV: "development" }),
    ).toBe(true);
    expect(
      fixtureModeEnabled({ E2E_FIXTURES: "0", NODE_ENV: "development" }),
    ).toBe(false);
    expect(
      fixtureModeEnabled({ E2E_FIXTURES: undefined, NODE_ENV: "test" }),
    ).toBe(false);
  });

  it("ignores the fixture flag and control cookie in production", () => {
    const request = new Request("https://example.test/api/sleeper/drafts/123", {
      headers: { cookie: "sac-e2e-step=2" },
    });

    expect(
      fixtureModeEnabled({ E2E_FIXTURES: "1", NODE_ENV: "production" }),
    ).toBe(false);
    expect(
      fixtureStepFromRequest(request, {
        E2E_FIXTURES: "1",
        NODE_ENV: "production",
      }),
    ).toBeNull();
  });

  it("bounds fixture steps and rejects malformed control cookies", () => {
    const environment = { E2E_FIXTURES: "1", NODE_ENV: "test" };
    const request = (cookie: string) =>
      new Request("https://example.test/api/sleeper/drafts/123", {
        headers: { cookie },
      });

    expect(fixtureStepFromRequest(request("sac-e2e-step=2"), environment)).toBe(
      2,
    );
    expect(
      fixtureStepFromRequest(request("sac-e2e-step=999"), environment),
    ).toBe(2);
    expect(
      fixtureStepFromRequest(request("sac-e2e-step=-1"), environment),
    ).toBe(0);
    expect(
      fixtureStepFromRequest(request("sac-e2e-step=wat"), environment),
    ).toBe(0);
  });
});
