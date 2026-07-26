import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DraftRoomViewModel } from "@/features/draft-room/model";
import { DraftRoomView } from "@/features/draft-room/components/draft-room";

const model = (overrides: Partial<DraftRoomViewModel> = {}): DraftRoomViewModel => ({
  draftId: "draft-1",
  draftStatus: "drafting",
  syncStatus: "fresh",
  lastUpdatedAt: "2026-07-25T12:00:00.000Z",
  projectionStatus: "fresh",
  projectionLabel: "Sleeper season projections",
  selectedPlayerId: "p1",
  selectedRosterId: 1,
  teams: [
    { rosterId: 1, name: "Gridiron Lab", remainingBudget: 151, openSlots: 4, maximumLegalBid: 148, players: [{ id: "owned", name: "Amon-Ra St. Brown", position: "WR", amount: 49, local: false }] },
    { rosterId: 2, name: "Sunday Office", remainingBudget: 180, openSlots: 5, maximumLegalBid: 176, players: [] },
  ],
  players: [
    {
      id: "p1", name: "Bijan Robinson", team: "ATL", position: "RB",
      points: 298.4, baseValue: 52, adjustedValue: 58, recommendedMaxBid: 57,
      maximumLegalBid: 148, preference: "target", explanation: "Target +$4.16, Roster need +$2.08.",
      adjustments: [{ label: "Target", delta: 4.16 }, { label: "Roster need", delta: 2.08 }],
    },
    {
      id: "p2", name: "Ja'Marr Chase", team: "CIN", position: "WR",
      points: 321.1, baseValue: 55, adjustedValue: 53, recommendedMaxBid: 53,
      maximumLegalBid: 148, preference: "neutral", explanation: "Balanced depth -$2.00.",
      adjustments: [{ label: "Balanced depth", delta: -2 }],
    },
    {
      id: "p3", name: "Josh Allen", team: "BUF", position: "QB",
      points: 402.5, baseValue: 31, adjustedValue: 34, recommendedMaxBid: 34,
      maximumLegalBid: 148, preference: "neutral", explanation: "Roster need +$3.00.",
      adjustments: [{ label: "Roster need", delta: 3 }],
    },
  ],
  recentPurchase: null,
  localCorrections: [],
  emptyMessage: null,
  ...overrides,
});

describe("DraftRoomView", () => {
  it("keeps base, strategy-adjusted, and maximum bid labels distinct", () => {
    render(<DraftRoomView model={model()} onRetry={vi.fn()} />);
    const now = screen.getByRole("region", { name: "Selected player" });
    expect(within(now).getByText("Base value")).toBeInTheDocument();
    expect(within(now).getByText("Adjusted value")).toBeInTheDocument();
    expect(within(now).getByText("My max bid")).toBeInTheDocument();
  });

  it("reveals a target and strategy explanation on demand", async () => {
    const user = userEvent.setup();
    render(<DraftRoomView model={model()} onRetry={vi.fn()} />);
    expect(screen.queryByText(/Target \+\$4\.16/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Why this value?" }));
    expect(screen.getByText(/Target \+\$4\.16/)).toBeInTheDocument();
    expect(screen.getByText(/Roster need \+\$2\.08/)).toBeInTheDocument();
  });

  it("removes a purchased player and reflects the updated budget", () => {
    const { rerender } = render(<DraftRoomView model={model()} onRetry={vi.fn()} />);
    expect(screen.getAllByText("Bijan Robinson").length).toBeGreaterThan(0);
    rerender(<DraftRoomView model={model({
      players: model().players.filter((player) => player.id !== "p1"),
      selectedPlayerId: "p2",
      teams: [{ ...model().teams[0], remainingBudget: 94, maximumLegalBid: 92, players: [...model().teams[0].players, { id: "p1", name: "Bijan Robinson", position: "RB", amount: 57, local: false }] }, model().teams[1]],
      recentPurchase: { playerName: "Bijan Robinson", teamName: "Gridiron Lab", amount: 57, local: false },
    })} onRetry={vi.fn()} />);
    expect(screen.getByText("$94")).toBeInTheDocument();
    expect(screen.getByText("Latest purchase · $57")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Bijan Robinson ATL RB/ })).not.toBeInTheDocument();
  });

  it("shows stale timestamp and retries", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<DraftRoomView model={model({ syncStatus: "stale" })} onRetry={retry} />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/Updated Jul 25/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry sync" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("labels a local correction and allows reversal", async () => {
    const user = userEvent.setup();
    const reverse = vi.fn();
    render(<DraftRoomView model={model({
      localCorrections: [{ playerId: "owned", playerName: "Amon-Ra St. Brown", teamName: "Gridiron Lab", amount: 49 }],
    })} onRetry={vi.fn()} onReverseCorrection={reverse} />);
    expect(screen.getByText("Local correction")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reverse correction for Amon-Ra St. Brown" }));
    expect(reverse).toHaveBeenCalledWith("owned");
  });

  it("narrows players with position filters and search", async () => {
    const user = userEvent.setup();
    render(<DraftRoomView model={model()} onRetry={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "RB" }));
    const board = screen.getByRole("region", { name: "Player board" });
    expect(within(board).getByText("Bijan Robinson")).toBeInTheDocument();
    expect(within(board).queryByText("Ja'Marr Chase")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("searchbox", { name: "Search available players" }), "Josh");
    expect(within(board).getByText("Josh Allen")).toBeInTheDocument();
    expect(within(board).queryByText("Bijan Robinson")).not.toBeInTheDocument();
  });

  it("exposes the exact mobile destinations", () => {
    render(<DraftRoomView model={model()} onRetry={vi.fn()} />);
    const tabs = screen.getByRole("tablist", { name: "Draft room sections" });
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Now", "Players", "My team", "League",
    ]);
  });

  it("labels recovery from a missing or invalid saved plan", () => {
    render(<DraftRoomView model={model({
      configurationNotice: "Using a recommended plan because no valid saved strategy was found.",
    })} onRetry={vi.fn()} />);
    expect(screen.getByText(/no valid saved strategy/i)).toBeInTheDocument();
  });
});
