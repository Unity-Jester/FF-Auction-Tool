import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("HomePage", () => {
  it("presents the Sleeper draft connection form", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "Own the room" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sleeper username or draft link"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect draft" })).toBeEnabled();
  });
});
