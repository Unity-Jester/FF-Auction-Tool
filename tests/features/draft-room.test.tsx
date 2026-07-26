import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/domain/draft/types";
import type { PlayerProjection } from "@/domain/players/types";
import { defaultStrategy } from "@/features/strategy/default-strategies";
import {
  buildDraftRoomViewModel,
  type DraftRoomViewModel,
  type PlayerSnapshot,
} from "@/features/draft-room/model";
import { DraftRoomView } from "@/features/draft-room/components/draft-room";
import completedAuction from "../fixtures/draft-room/completed-public-auction-shape.json";

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

  it("does not introduce a nested main landmark", () => {
    const { container } = render(<DraftRoomView model={model()} onRetry={vi.fn()} />);
    expect(container.querySelector("main")).toBeNull();
  });

  it("keeps retry and correction actions at the shared touch-target size", async () => {
    const user = userEvent.setup();
    render(<DraftRoomView
      model={model({
        syncStatus: "stale",
        localCorrections: [{ playerId: "owned", playerName: "Amon-Ra St. Brown", teamName: "Gridiron Lab", amount: 49 }],
      })}
      onRetry={vi.fn()}
      onReverseCorrection={vi.fn()}
      onAddCorrection={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: "Retry sync" }).className).toContain("criticalAction");
    expect(screen.getByRole("button", { name: "Reverse correction for Amon-Ra St. Brown" }).className).toContain("criticalAction");
    await user.click(screen.getByRole("button", { name: "Add local purchase correction" }));
    expect(screen.getByRole("button", { name: "Save local correction" }).className).toContain("criticalAction");

    const roomStyles = readFileSync("src/features/draft-room/draft-room.module.css", "utf8");
    const globalStyles = readFileSync("src/app/globals.css", "utf8");
    expect(roomStyles).toMatch(/button\.criticalAction[^}]*min-height:\s*var\(--target-size\)/s);
    expect(globalStyles).toContain("--target-size: 2.75rem");
  });
});

describe("buildDraftRoomViewModel", () => {
  const completed = completedAuction as DraftSnapshot;
  const projection = (playerId: string, position: "QB" | "RB", index: number): PlayerProjection => ({
    playerId,
    name: `Player ${playerId}`,
    team: "NFL",
    positions: [position],
    stats: position === "QB"
      ? { passYards: 4500 - index * 25, passTds: 30 }
      : { rushYards: 1400 - index * 25, rushTds: 10, receptions: 40 },
    source: "Regression fixture",
    updatedAt: "2026-07-26T12:00:00.000Z",
  });
  const projections = [
    ...Array.from({ length: 12 }, (_, index) => projection(`qb${index + 1}`, "QB", index)),
    ...Array.from({ length: 12 }, (_, index) => projection(`rb${index + 1}`, "RB", index)),
    projection("free-rb", "RB", 12),
  ];
  const players: PlayerSnapshot[] = projections.map((item) => ({
    playerId: item.playerId,
    name: item.name,
    team: item.team,
    positions: [...item.positions],
  }));

  it("keeps completed-draft values reviewable when full rosters retain unused dollars", () => {
    const result = buildDraftRoomViewModel({
      snapshot: completed,
      league: completed.league,
      strategy: defaultStrategy(completed.league),
      preferences: {},
      projections,
      projectionSource: "Regression fixture",
      projectionStale: false,
      playerSnapshot: players,
      myRosterId: 1,
      localCorrections: [],
      syncStatus: "fresh",
      lastUpdatedAt: completed.lastUpdatedAt,
    });

    expect(result.emptyMessage).toBeNull();
    expect(result.players).toEqual([
      expect.objectContaining({ id: "free-rb", baseValue: 0, recommendedMaxBid: 0 }),
    ]);
    expect(result.teams[0]).toEqual(expect.objectContaining({ remainingBudget: 5, openSlots: 0 }));
  });

  it("surfaces a safe valuation reason when draft inputs are truly invalid", () => {
    const invalid: DraftSnapshot = {
      ...completed,
      teams: [{ ...completed.teams[0], remainingBudget: -1 }, ...completed.teams.slice(1)],
    };
    const result = buildDraftRoomViewModel({
      snapshot: invalid,
      league: invalid.league,
      strategy: defaultStrategy(invalid.league),
      preferences: {},
      projections,
      projectionSource: "Regression fixture",
      projectionStale: false,
      playerSnapshot: players,
      myRosterId: 1,
      localCorrections: [],
      syncStatus: "fresh",
      lastUpdatedAt: invalid.lastUpdatedAt,
    });

    expect(result.emptyMessage).toMatch(/remaining budget/i);
    expect(result.emptyMessage).not.toMatch(/until the saved setup matches/i);
  });
});
