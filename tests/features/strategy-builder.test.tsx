import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createLeagueConfig } from "@/domain/league/defaults";
import { StrategyBuilder } from "@/features/strategy/components/strategy-builder";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const league = createLeagueConfig({
  teams: 12,
  budget: 200,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
  bench: 6,
  flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
  receptionPoints: 1,
});

describe("StrategyBuilder", () => {
  it("switches to a stars-and-scrubs spending curve", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    await user.click(screen.getByRole("button", { name: "Stars and scrubs" }));
    expect(screen.getByText("Aggressive early spending")).toBeInTheDocument();
  });

  it("keeps starter and bench budget totals aligned with total spend", async () => {
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    expect(screen.getByLabelText("Starter budget")).toHaveValue(136);
    expect(screen.getByLabelText("Bench budget")).toHaveValue(64);
    expect(screen.getByText("Starter + bench: $200")).toBeInTheDocument();
  });

  it("makes a preset custom when its spending curve is edited", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    await user.clear(screen.getByLabelText("Purchase 1 curve"));
    await user.type(screen.getByLabelText("Purchase 1 curve"), "1.4");
    expect(screen.getByRole("button", { name: "Custom" })).toHaveClass(
      "selected",
    );
  });

  it("updates positional approaches in the projected blueprint", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    await user.selectOptions(screen.getByLabelText("QB approach"), "elite");
    await user.selectOptions(screen.getByLabelText("TE approach"), "value");
    await user.selectOptions(screen.getByLabelText("RB build"), "hero");
    expect(
      screen.getByText(/QB elite · TE value · RB hero/),
    ).toBeInTheDocument();
  });

  it("updates player target and avoid preferences", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    await user.type(
      screen.getByLabelText("Player preference"),
      "Bijan Robinson",
    );
    await user.click(screen.getByRole("button", { name: "Target player" }));
    expect(screen.getByText("Bijan Robinson · Target")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Avoid player" }));
    expect(screen.getByText("Bijan Robinson · Avoid")).toBeInTheDocument();
  });

  it("stores a manual value for a player", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    await user.type(
      screen.getByLabelText("Player preference"),
      "Bijan Robinson",
    );
    await user.clear(screen.getByLabelText("Manual value"));
    await user.type(screen.getByLabelText("Manual value"), "61");
    await user.click(screen.getByRole("button", { name: "Set manual value" }));
    expect(screen.getByText("Bijan Robinson · Manual $61")).toBeInTheDocument();
  });

  it("prevents entry while position budgets do not equal available spend", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    const qb = screen.getByLabelText("QB budget");
    await user.clear(qb);
    await user.type(qb, "99");
    expect(
      screen.getByText(/Position budgets must equal \$200/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enter draft room" }),
    ).toBeDisabled();
  });

  it("persists strategy before entering the draft room", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    await user.click(screen.getByRole("button", { name: "Enter draft room" }));
    expect(
      window.localStorage.getItem(
        "sleeper-auction-companion:session:123456789012345678",
      ),
    ).toContain("recommended");
    expect(push).toHaveBeenCalledWith("/draft/123456789012345678");
  });
});
