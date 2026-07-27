import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig, { buildSecurityHeaders } from "../../next.config";
import { createProjectionsHandler } from "@/app/api/projections/route";

describe("release configuration hardening", () => {
  it("ignores every environment file except the safe example", () => {
    const gitignore = readFileSync(resolve(".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
    const tracked = execFileSync("git", ["ls-files", ".env*"], {
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean);
    expect(tracked).toEqual([".env.example"]);
  });

  it("pins official workflow actions and opens reviewable snapshot pull requests", () => {
    for (const file of [
      ".github/workflows/refresh-sleeper-players.yml",
      ".github/workflows/refresh-projections.yml",
    ]) {
      const workflow = readFileSync(resolve(file), "utf8");
      expect(workflow).toContain(
        "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
      );
      expect(workflow).toContain(
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      );
      expect(workflow).not.toMatch(/uses:\s+actions\/[^@\s]+@v\d/);
      expect(workflow).not.toContain("npm ci");
      expect(workflow).toContain("pull-requests: write");
      expect(workflow).toContain("gh pr create");
      expect(workflow).not.toMatch(/\bgit push\s*$/m);
    }
  });

  it("disables the framework banner and sends production security headers", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const groups = await nextConfig.headers?.();
    const values = new Map(
      groups?.flatMap((group) => group.headers).map((header) => [
        header.key,
        header.value,
      ]),
    );
    expect(values.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    expect(values.get("Content-Security-Policy")).toContain(
      "https://*.hcaptcha.com",
    );
    const productionValues = new Map(
      buildSecurityHeaders({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      }).map((header) => [header.key, header.value]),
    );
    expect(productionValues.get("Content-Security-Policy")).toContain(
      "https://project.supabase.co",
    );
    expect(productionValues.get("Strict-Transport-Security")).toContain(
      "max-age=31536000",
    );
  });

  it("caches a stale projection fallback for much less time than fresh data", async () => {
    const fresh = await createProjectionsHandler({
      load: async () => ({
        source: "fresh",
        updatedAt: "2026-07-26T00:00:00.000Z",
        stale: false,
        projections: [],
      }),
    })();
    const stale = await createProjectionsHandler({
      load: async () => ({
        source: "fallback",
        updatedAt: "2026-07-20T00:00:00.000Z",
        stale: true,
        projections: [],
      }),
    })();

    expect(fresh.headers.get("Cache-Control")).toBe(
      "public, s-maxage=21600, stale-while-revalidate=86400",
    );
    expect(stale.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=900",
    );
  });
});
