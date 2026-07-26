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
  minBid: 1,
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
  ignoredCorrections: [],
  dataWarnings: [],
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
      recentPurchase: { playerId: "p1", rosterId: 1, playerName: "Bijan Robinson", teamName: "Gridiron Lab", amount: 57, local: false },
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
    const addCorrection = screen.getByRole("button", { name: "Add local purchase correction" });
    expect(addCorrection.className).toContain("criticalAction");
    await user.click(addCorrection);
    expect(screen.getByRole("button", { name: "Save local correction" }).className).toContain("criticalAction");

    const roomStyles = readFileSync("src/features/draft-room/draft-room.module.css", "utf8");
    const globalStyles = readFileSync("src/app/globals.css", "utf8");
    expect(roomStyles).toMatch(/button\.criticalAction[^}]*min-height:\s*var\(--target-size\)/s);
    expect(globalStyles).toContain("--target-size: 2.75rem");
  });

  it("validates corrections against the minimum bid and the corrected team's legal maximum", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<DraftRoomView model={model({ minBid: 2 })} onRetry={vi.fn()} onAddCorrection={save} />);
    await user.click(screen.getByRole("button", { name: "Add local purchase correction" }));
    const amount = screen.getByRole("spinbutton", { name: "Local sale price" });

    await user.type(amount, "1");
    await user.click(screen.getByRole("button", { name: "Save local correction" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/minimum bid is \$2/i);
    expect(save).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, "149");
    await user.click(screen.getByRole("button", { name: "Save local correction" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/maximum legal price is \$145/i);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a new correction when the destination roster has no open slot", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<DraftRoomView model={model({
      teams: [
        { ...model().teams[0], remainingBudget: 20, openSlots: 0, maximumLegalBid: 0 },
        model().teams[1],
      ],
    })} onRetry={vi.fn()} onAddCorrection={save} />);

    await user.click(screen.getByRole("button", { name: "Add local purchase correction" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/no open roster slots/i);
    await user.type(screen.getByRole("spinbutton", { name: "Local sale price" }), "5");
    await user.click(screen.getByRole("button", { name: "Save local correction" }));
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a transfer to a full roster but permits a price-only edit on its current full roster", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<DraftRoomView model={model({
      teams: [
        { ...model().teams[0], remainingBudget: 10, openSlots: 0, maximumLegalBid: 0 },
        { ...model().teams[1], remainingBudget: 30, openSlots: 0, maximumLegalBid: 0 },
      ],
    })} onRetry={vi.fn()} onAddCorrection={save} />);

    await user.click(screen.getByRole("button", { name: "Edit purchase for Amon-Ra St. Brown" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Assign to" }), "2");
    expect(screen.getByRole("alert")).toHaveTextContent(/no open roster slots/i);
    await user.click(screen.getByRole("button", { name: "Save local correction" }));
    expect(save).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole("combobox", { name: "Assign to" }), "1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.clear(screen.getByRole("spinbutton", { name: "Local sale price" }));
    await user.type(screen.getByRole("spinbutton", { name: "Local sale price" }), "55");
    await user.click(screen.getByRole("button", { name: "Save local correction" }));
    expect(save).toHaveBeenCalledWith("owned", 1, 55);
  });

  it("edits an existing roster purchase in place with the owner and price prefilled", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<DraftRoomView model={model()} onRetry={vi.fn()} onAddCorrection={save} />);

    await user.click(screen.getByRole("button", { name: "Edit purchase for Amon-Ra St. Brown" }));
    expect(screen.getByRole("spinbutton", { name: "Local sale price" })).toHaveValue(49);
    expect(screen.getByRole("combobox", { name: "Assign to" })).toHaveValue("1");
    await user.clear(screen.getByRole("spinbutton", { name: "Local sale price" }));
    await user.type(screen.getByRole("spinbutton", { name: "Local sale price" }), "45");
    await user.click(screen.getByRole("button", { name: "Save local correction" }));

    expect(save).toHaveBeenCalledWith("owned", 1, 45);
  });

  it("shows completed local conflicts separately and leaves them reversible", async () => {
    const user = userEvent.setup();
    const reverse = vi.fn();
    render(<DraftRoomView model={model({
      draftStatus: "complete",
      ignoredCorrections: [{
        playerId: "owned",
        playerName: "Amon-Ra St. Brown",
        teamName: "Sunday Office",
        amount: 1,
        reason: "Ignored because final Sleeper results are authoritative.",
      }],
    })} onRetry={vi.fn()} onReverseCorrection={reverse} />);

    expect(screen.getByText(/Ignored local conflict/)).toBeInTheDocument();
    expect(screen.getByText(/final Sleeper results are authoritative/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reverse ignored correction for Amon-Ra St. Brown" }));
    expect(reverse).toHaveBeenCalledWith("owned");
  });

  it("offers an explicit way to change the selected roster", async () => {
    const user = userEvent.setup();
    const changeRoster = vi.fn();
    render(<DraftRoomView model={model()} onRetry={vi.fn()} onChangeRoster={changeRoster} />);
    await user.click(screen.getByRole("button", { name: "Change roster" }));
    expect(changeRoster).toHaveBeenCalledOnce();
  });

  it("selects a player only once when its nested button is clicked", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(<DraftRoomView model={model()} onRetry={vi.fn()} onSelectPlayer={select} />);
    await user.click(screen.getByRole("button", { name: /Ja'Marr Chase/ }));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("progressively renders a large player board", async () => {
    const user = userEvent.setup();
    const largePlayers = Array.from({ length: 400 }, (_, index) => ({
      ...model().players[0],
      id: `player-${index}`,
      name: `Player ${index}`,
    }));
    render(<DraftRoomView model={model({ players: largePlayers })} onRetry={vi.fn()} />);

    expect(screen.getAllByRole("row")).toHaveLength(81);
    await user.click(screen.getByRole("button", { name: /Load 80 more players/i }));
    expect(screen.getAllByRole("row")).toHaveLength(161);
  });

  it("connects tabs to panels and supports keyboard tab navigation", async () => {
    const user = userEvent.setup();
    render(<DraftRoomView model={model()} onRetry={vi.fn()} />);
    const now = screen.getByRole("tab", { name: "Now" });
    const playersTab = screen.getByRole("tab", { name: "Players" });
    expect(now).toHaveAttribute("aria-controls", "draft-panel-now");
    expect(screen.getByRole("tabpanel", { name: "Now" })).toHaveAttribute("id", "draft-panel-now");

    now.focus();
    await user.keyboard("{ArrowRight}");
    expect(playersTab).toHaveFocus();
    expect(playersTab).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "League" })).toHaveFocus();
  });

  it("unmounts inactive mobile panels instead of keeping the whole room hidden", async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 767px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const user = userEvent.setup();
    const { unmount } = render(<DraftRoomView model={model()} onRetry={vi.fn()} />);

    expect(screen.getByRole("tabpanel", { name: "Now" })).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Players" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.queryByRole("tabpanel", { name: "Now" })).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Players" })).toBeInTheDocument();

    unmount();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
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
      purchases: [
        { ...completed.purchases[0], amount: 1_000 },
        ...completed.purchases.slice(1),
      ],
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
    expect(result.teams[0].remainingBudget).toBeLessThan(0);
  });

  it("rebuilds team money and roster slots from the corrected league setup and purchases", () => {
    const correctedLeague = { ...completed.league, budget: 250 };
    const result = buildDraftRoomViewModel({
      snapshot: completed,
      league: correctedLeague,
      strategy: defaultStrategy(correctedLeague),
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

    expect(result.teams[0]).toEqual(expect.objectContaining({
      remainingBudget: 55,
      openSlots: 0,
    }));
  });

  it("blocks valuation instead of mixing a 10-team corrected setup with a 12-team Sleeper draft", () => {
    const tenTeamLeague = { ...completed.league, teams: 10 };
    const result = buildDraftRoomViewModel({
      snapshot: completed,
      league: tenTeamLeague,
      strategy: defaultStrategy(tenTeamLeague),
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

    expect(result.emptyMessage).toMatch(/saved setup has 10 teams.*Sleeper draft has 12/i);
    expect(result.reviewSetupRequired).toBe(true);
    expect(result.players).toEqual([]);
    expect(result.teams).toHaveLength(12);
    expect(result.teams[0]).toEqual(expect.objectContaining({
      remainingBudget: completed.teams[0].remainingBudget,
      openSlots: completed.teams[0].openSlots,
      maximumLegalBid: null,
    }));
  });

  it("links a blocked team-count mismatch back to setup review", () => {
    render(<DraftRoomView model={model({
      players: [],
      emptyMessage: "Values unavailable: saved setup has 10 teams, but Sleeper draft has 12.",
      reviewSetupRequired: true,
    })} onRetry={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Review setup" })).toHaveAttribute(
      "href",
      "/draft/draft-1/setup",
    );
  });

  it("uses final Sleeper purchases and quarantines unresolved local corrections after completion", () => {
    const local = {
      ...completed.purchases[0],
      rosterId: 2,
      amount: 1,
      source: "local" as const,
    };
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
      localCorrections: [local],
      syncStatus: "fresh",
      lastUpdatedAt: completed.lastUpdatedAt,
    });

    expect(result.teams[0].players.some((player) => player.id === local.playerId)).toBe(true);
    expect(result.teams[1].players.some((player) => player.id === local.playerId)).toBe(false);
    expect(result.ignoredCorrections).toEqual([
      expect.objectContaining({ playerId: local.playerId, amount: 1 }),
    ]);
  });

  it("treats an active correction as a replacement of the original owner and price", () => {
    const active = { ...completed, status: "drafting" as const };
    const original = active.purchases[0];
    const correction = {
      ...original,
      rosterId: 2,
      amount: 33,
      source: "local" as const,
    };
    const result = buildDraftRoomViewModel({
      snapshot: active,
      league: active.league,
      strategy: defaultStrategy(active.league),
      preferences: {},
      projections,
      projectionSource: "Regression fixture",
      projectionStale: false,
      playerSnapshot: players,
      myRosterId: 1,
      localCorrections: [correction],
      syncStatus: "fresh",
      lastUpdatedAt: active.lastUpdatedAt,
    });

    expect(result.teams[0].players.some((player) => player.id === original.playerId)).toBe(false);
    expect(result.teams[1].players).toContainEqual(
      expect.objectContaining({ id: original.playerId, amount: 33, local: true }),
    );
    expect(result.teams.flatMap((team) => team.players).filter((player) => player.id === original.playerId)).toHaveLength(1);
  });

  it("keeps purchased players with metadata but no projection in roster and position calculations", () => {
    const withoutPurchasedProjection = projections.filter(
      (item) => item.playerId !== completed.purchases[0].playerId,
    );
    const result = buildDraftRoomViewModel({
      snapshot: completed,
      league: completed.league,
      strategy: defaultStrategy(completed.league),
      preferences: {},
      projections: withoutPurchasedProjection,
      projectionSource: "Regression fixture",
      projectionStale: false,
      playerSnapshot: players,
      myRosterId: 1,
      localCorrections: [],
      syncStatus: "fresh",
      lastUpdatedAt: completed.lastUpdatedAt,
    });

    expect(result.teams[0].players).toContainEqual(
      expect.objectContaining({ id: completed.purchases[0].playerId, position: "QB" }),
    );
    expect(result.emptyMessage).toBeNull();
    expect(result.dataWarnings).toEqual([]);
  });

  it("warns about a purchase only when it cannot be joined to usable position metadata", () => {
    const unjoinableId = completed.purchases[0].playerId;
    const result = buildDraftRoomViewModel({
      snapshot: completed,
      league: completed.league,
      strategy: defaultStrategy(completed.league),
      preferences: {},
      projections: projections.filter((item) => item.playerId !== unjoinableId),
      projectionSource: "Regression fixture",
      projectionStale: false,
      playerSnapshot: players.filter((item) => item.playerId !== unjoinableId),
      myRosterId: 1,
      localCorrections: [],
      syncStatus: "fresh",
      lastUpdatedAt: completed.lastUpdatedAt,
    });

    expect(result.teams[0].players).toContainEqual(
      expect.objectContaining({ id: unjoinableId, position: null }),
    );
    expect(result.dataWarnings).toEqual([
      "1 purchase could not be joined to player position data.",
    ]);
  });

  it.each([
    ["authoritative", []],
    ["local correction", [{
      ...completed.purchases[0],
      rosterId: 99,
      source: "local" as const,
    }]],
  ])("blocks partial guidance when an unknown roster appears in an %s record", (_, localCorrections) => {
    const active: DraftSnapshot = {
      ...completed,
      status: "drafting",
      purchases: localCorrections.length
        ? completed.purchases
        : [{ ...completed.purchases[0], rosterId: 99 }, ...completed.purchases.slice(1)],
    };
    const result = buildDraftRoomViewModel({
      snapshot: active,
      league: active.league,
      strategy: defaultStrategy(active.league),
      preferences: {},
      projections,
      projectionSource: "Regression fixture",
      projectionStale: false,
      playerSnapshot: players,
      myRosterId: 1,
      localCorrections,
      syncStatus: "fresh",
      lastUpdatedAt: active.lastUpdatedAt,
    });

    expect(result.emptyMessage).toMatch(/unknown roster.*review setup/i);
    expect(result.players).toEqual([]);
    expect(result.teams.every((team) => team.maximumLegalBid === null)).toBe(true);
    expect(result.dataWarnings).toContain(
      "1 purchase was quarantined because it referenced an unknown roster.",
    );
  });
});
