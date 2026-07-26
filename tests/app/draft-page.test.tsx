import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DraftPage from "@/app/draft/[draftId]/page";

describe("DraftPage", () => {
  it("renders an honest draft-room shell with setup recovery", async () => {
    render(
      await DraftPage({
        params: Promise.resolve({ draftId: "123456789012345678" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Draft room is next." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/live draft workspace is not loaded yet/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review setup" })).toHaveAttribute(
      "href",
      "/draft/123456789012345678/setup",
    );
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Draft room is next." }),
    ).toBeInTheDocument();
  });
});
