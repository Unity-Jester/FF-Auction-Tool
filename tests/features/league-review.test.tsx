import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createLeagueConfig } from "@/domain/league/defaults";
import { LeagueReview } from "@/features/setup/components/league-review";
import {
  loadLeagueConfig,
  leagueSetupStatus,
  resolveLeagueConfig,
  saveLeagueConfig,
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
  it("requires explicit confirmation when Sleeper scoring is unknown and labels local corrections", async () => {
    const user = userEvent.setup();
    render(
      <LeagueReview
        draftId="123456789012345678"
        league={league}
        draftStatus="drafting"
        warnings={[
          {
            code: "SCORING_DEFAULTED",
            source: "draft.metadata.scoring_type",
            message: "Unknown mock scoring type; defaulted supported scoring rules",
          },
        ]}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Sleeper did not provide usable scoring rules/i,
    );
    expect(screen.getByText("Live draft")).toBeInTheDocument();
    expect(screen.getByLabelText("Reception points").closest("label")).toHaveTextContent(
      "Defaulted",
    );
    expect(screen.getByRole("button", { name: "Set strategy" })).toBeDisabled();

    await user.clear(screen.getByLabelText("Reception points"));
    await user.type(screen.getByLabelText("Reception points"), "1");
    expect(screen.getByLabelText("Reception points").closest("label")).toHaveTextContent(
      "Local edit",
    );
    await user.click(screen.getByLabelText("I verified the scoring rules"));
    expect(screen.getByRole("button", { name: "Set strategy" })).toBeEnabled();
  });

  it("distinguishes inferred reception scoring from other defaulted mock fields", () => {
    render(
      <LeagueReview
        draftId="123456789012345678"
        league={league}
        warnings={[
          {
            code: "SCORING_INFERRED",
            source: "draft.metadata.scoring_type",
            message: "Reception scoring inferred from ppr",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Reception points").closest("label")).toHaveTextContent(
      "Inferred from scoring type",
    );
    expect(screen.getByLabelText("Pass touchdown").closest("label")).toHaveTextContent(
      "Defaulted",
    );
    expect(screen.getByRole("button", { name: "Set strategy" })).toBeEnabled();
  });

  it("adds and removes flex groups and shows the derived roster summary", async () => {
    const user = userEvent.setup();
    const noFlex = createLeagueConfig({
      teams: 12,
      budget: 200,
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
      bench: 6,
      flex: [],
      receptionPoints: 1,
    });
    render(<LeagueReview draftId="123456789012345678" league={noFlex} />);

    expect(screen.getByText(/8 fixed starters · 0 flex · 6 bench · 14 total/i)).toBeInTheDocument();
    expect(screen.getByText(/Feasible/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add flex group" }));
    expect(screen.getByLabelText("Flex 1 slots")).toBeInTheDocument();
    expect(screen.getByText(/8 fixed starters · 1 flex · 6 bench · 15 total/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove flex group 1" }));
    expect(screen.queryByLabelText("Flex 1 slots")).not.toBeInTheDocument();
  });

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

  it("shows the auction money ceilings at the form boundary", async () => {
    const user = userEvent.setup();
    render(<LeagueReview draftId="123456789012345678" league={league} />);
    const budget = screen.getByLabelText("Auction budget");
    const minBid = screen.getByLabelText("Minimum bid");
    expect(budget).toHaveAttribute("max", "100000");
    expect(minBid).toHaveAttribute("max", "10000");

    await user.clear(budget);
    await user.type(budget, "100001");
    await user.click(screen.getByRole("button", { name: "Set strategy" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Budget cannot exceed $100,000",
    );

    await user.clear(budget);
    await user.type(budget, "200");
    await user.clear(minBid);
    await user.type(minBid, "201");
    await user.click(screen.getByRole("button", { name: "Set strategy" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Minimum bid cannot exceed the auction budget",
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

  it("labels persisted corrections against the imported source after reload", () => {
    const corrected = createLeagueConfig({
      ...league,
      teams: 10,
      receptionPoints: 0.5,
      capKickerDefenseAtOne: true,
    });

    render(
      <LeagueReview
        draftId="provenance-reload"
        league={corrected}
        importedLeague={league}
        warnings={[
          {
            code: "SCORING_INFERRED",
            source: "draft.metadata.scoring_type",
            message: "Reception scoring inferred from ppr",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Teams").closest("label")).toHaveTextContent(
      "Local edit",
    );
    expect(
      screen.getByLabelText("Reception points").closest("label"),
    ).toHaveTextContent("Local edit");
    expect(screen.getByLabelText("Pass touchdown").closest("label")).toHaveTextContent(
      "Defaulted",
    );
    expect(screen.getByLabelText("K/DEF at $1").closest("label")).toHaveTextContent(
      "Default",
    );
  });

  it("distinguishes intentional setup edits from later upstream structural drift", () => {
    const corrected = { ...league, teams: 10 };
    saveLeagueConfig("baseline-draft", corrected, league);
    expect(leagueSetupStatus("baseline-draft", league)).toBe("match");
    expect(resolveLeagueConfig("baseline-draft", league)).toEqual(corrected);

    const changedUpstream = { ...league, budget: 250 };
    expect(leagueSetupStatus("baseline-draft", changedUpstream)).toBe("mismatch");
    expect(resolveLeagueConfig("baseline-draft", changedUpstream)).toEqual(corrected);
  });

  it("treats legacy setup records conservatively", () => {
    localStorage.setItem("sleeper-auction-companion:league:legacy-draft", JSON.stringify({ version: 1, league }));
    expect(leagueSetupStatus("legacy-draft", league)).toBe("legacy");
    expect(resolveLeagueConfig("legacy-draft", league)).toEqual(league);
  });
});
