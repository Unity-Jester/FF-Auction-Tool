import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DraftPage from "@/app/draft/[draftId]/page";

vi.mock("@/features/draft-room/components/draft-room", () => ({
  DraftRoom: ({ draftId }: { draftId: string }) => (
    <section aria-label="Live draft room">Draft {draftId}</section>
  ),
}));

describe("DraftPage", () => {
  it("passes only the route identifier into the client draft room", async () => {
    render(
      await DraftPage({
        params: Promise.resolve({ draftId: "123456789012345678" }),
      }),
    );

    expect(screen.getByRole("region", { name: "Live draft room" }))
      .toHaveTextContent("Draft 123456789012345678");
  });
});
