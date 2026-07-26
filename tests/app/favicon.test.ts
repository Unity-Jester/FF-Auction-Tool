import { describe, expect, it } from "vitest";
import { GET } from "@/app/favicon.ico/route";

describe("favicon", () => {
  it("serves an application icon at the conventional browser path", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });
});
