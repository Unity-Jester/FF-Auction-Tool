import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createLeagueConfig } from "@/domain/league/defaults";
import { LeagueReview } from "@/features/setup/components/league-review";
import {
  loadLeagueConfig,
  resolveLeagueConfig,
} from "@/persistence/league-storage";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const league = createLeagueConfig({
  teams: 12,
  budget: 200,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
  bench: 6,
  flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
  receptionPoints: 1,
  scoring: { positionReceptionBonus: { RB: 0.25, WR: 0.5, TE: 1 } },
});

describe("LeagueReview", () => {
  it("edits every roster, flex, scoring, and cap setting before persisting it", async () => {
    const user = userEvent.setup();
    render(<LeagueReview draftId="123456789012345678" league={league} />);
    for (const label of [
      "QB starters",
      "RB starters",
      "WR starters",
      "TE starters",
      "K starters",
      "DEF starters",
      "Bench slots",
      "Flex 1 slots",
      "Flex 1 eligibility",
      "Reception points",
      "Pass touchdown",
      "RB reception bonus",
      "WR reception bonus",
      "TE reception bonus",
      "K/DEF at $1",
    ])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("QB starters"));
    await user.type(screen.getByLabelText("QB starters"), "2");
    await user.clear(screen.getByLabelText("Flex 1 eligibility"));
    await user.type(screen.getByLabelText("Flex 1 eligibility"), "QB,RB,WR,TE");
    await user.click(screen.getByLabelText("K/DEF at $1"));
    await user.click(screen.getByRole("button", { name: "Set strategy" }));
    expect(loadLeagueConfig("123456789012345678")).toMatchObject({
      starters: { QB: 2 },
      flex: [{ eligible: ["QB", "RB", "WR", "TE"] }],
      capKickerDefenseAtOne: false,
      rosterSize: 16,
      scoring: { positionReceptionBonus: { RB: 0.25, WR: 0.5, TE: 1 } },
    });
    expect(push).toHaveBeenCalledWith("/draft/123456789012345678/strategy");
  });

  it("blocks impossible roster budgets", async () => {
    const user = userEvent.setup();
    render(<LeagueReview draftId="123456789012345678" league={league} />);
    await user.clear(screen.getByLabelText("Auction budget"));
    await user.type(screen.getByLabelText("Auction budget"), "10");
    await user.click(screen.getByRole("button", { name: "Set strategy" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Budget must cover every roster slot",
    );
  });

  it("shows saved corrections again after strategy or draft navigation", async () => {
    const user = userEvent.setup();
    const first = render(
      <LeagueReview draftId="123456789012345678" league={league} />,
    );
    await user.clear(screen.getByLabelText("Teams"));
    await user.type(screen.getByLabelText("Teams"), "10");
    await user.clear(screen.getByLabelText("TE reception bonus"));
    await user.type(screen.getByLabelText("TE reception bonus"), "1.5");
    await user.click(screen.getByRole("button", { name: "Set strategy" }));
    first.unmount();

    render(
      <LeagueReview
        draftId="123456789012345678"
        league={resolveLeagueConfig("123456789012345678", league)}
      />,
    );
    expect(screen.getByLabelText("Teams")).toHaveValue("10");
    expect(screen.getByLabelText("TE reception bonus")).toHaveValue("1.5");
  });
});
