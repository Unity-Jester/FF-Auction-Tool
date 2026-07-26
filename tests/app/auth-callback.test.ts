import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/app/auth/callback/route";

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
});
