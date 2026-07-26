import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publicSupabaseConfigFromEnv = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock("@/integrations/supabase/config", () => ({
  publicSupabaseConfigFromEnv: () => publicSupabaseConfigFromEnv(),
}));
vi.mock("@/integrations/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession },
  }),
}));

import { GET, safeNextPath } from "@/app/auth/callback/route";

beforeEach(() => {
  publicSupabaseConfigFromEnv.mockReturnValue({
    url: "https://project.supabase.co",
    publicKey: "sb_publishable_public",
  });
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("auth callback redirect", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/draft/123/strategy?tab=saved")).toBe(
      "/draft/123/strategy?tab=saved",
    );
    expect(safeNextPath("https://evil.example/steal")).toBe("/");
    expect(safeNextPath("//evil.example/steal")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });

  it.each([
    "https://app.example/auth/callback?next=%2Fdraft%2F123",
    "https://app.example/auth/callback?next=%2Fdraft%2F123&error=access_denied&error_description=provider%20secret",
    "https://app.example/auth/callback?next=%2Fdraft%2F123&code=",
  ])("normalizes missing and provider callback failures", async (url) => {
    const response = await GET(new NextRequest(url));
    expect(response.headers.get("location")).toBe(
      "https://app.example/draft/123?auth=error",
    );
  });

  it("normalizes expired or consumed code exchange failures", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({
      error: { message: "OTP expired secret provider detail" },
    });
    const response = await GET(new NextRequest(
      "https://app.example/auth/callback?next=%2Fdraft%2F123&code=consumed-code",
    ));
    expect(response.headers.get("location")).toBe(
      "https://app.example/draft/123?auth=error",
    );
  });

  it("returns to the safe path after a successful exchange", async () => {
    const response = await GET(new NextRequest(
      "https://app.example/auth/callback?next=%2Fdraft%2F123%3Ftab%3Dsaved&code=valid-code",
    ));
    expect(response.headers.get("location")).toBe(
      "https://app.example/draft/123?tab=saved",
    );
  });
});
