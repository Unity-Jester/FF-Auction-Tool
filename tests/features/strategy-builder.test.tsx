import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLeagueConfig } from "@/domain/league/defaults";
import { StrategyBuilder } from "@/features/strategy/components/strategy-builder";
import { defaultStrategy } from "@/features/strategy/default-strategies";
import { loadSession, saveSession } from "@/persistence/session-storage";

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
  afterEach(() => {
    window.localStorage.clear();
    push.mockClear();
  });
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

  it("saves and reloads a named strategy in guest mode", async () => {
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    await user.type(screen.getByLabelText("Saved strategy name"), "Sunday plan");
    await user.click(screen.getByRole("button", { name: "Save named strategy" }));
    expect(await screen.findByText("Sunday plan")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stars and scrubs" }));
    expect(screen.getByText("Aggressive early spending")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load Sunday plan" }));
    expect(screen.getByText("Flexible auction plan")).toBeInTheDocument();
  });

  it("enforces the saved strategy name limit in the interface", () => {
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    expect(screen.getByLabelText("Saved strategy name")).toHaveAttribute(
      "maxlength",
      "80",
    );
  });

  it("loads an existing plan and preserves its preferences and manual values", () => {
    const draftId = "223456789012345678";
    const existing = defaultStrategy(league);
    existing.preferences = { "Bijan Robinson": "target" };
    existing.valueOverrides = { "Bijan Robinson": 61 };
    saveSession({
      version: 1,
      draftId,
      strategy: existing,
      preferences: { "Ja'Marr Chase": "avoid" },
      localCorrections: [],
      csvProjectionOverrides: [],
      savedAt: "2026-07-26T12:00:00.000Z",
    });

    render(<StrategyBuilder draftId={draftId} league={league} />);

    expect(screen.getByText("Bijan Robinson · Target")).toBeInTheDocument();
    expect(screen.getByText("Bijan Robinson · Manual $61")).toBeInTheDocument();
  });

  it("merges edits without erasing corrections, CSV overrides, or session preferences", async () => {
    const user = userEvent.setup();
    const draftId = "323456789012345678";
    const existing = defaultStrategy(league);
    const correction = {
      draftId,
      playerId: "p1",
      rosterId: 1,
      amount: 21,
      pickNo: 1,
      createdAt: null,
      source: "local" as const,
      keeper: false,
    };
    const csv = {
      playerId: "p2",
      name: "CSV Player",
      team: "NFL",
      positions: ["RB" as const],
      stats: { rushYards: 1000 },
      source: "CSV",
      updatedAt: "2026-07-26T12:00:00.000Z",
    };
    saveSession({
      version: 1,
      draftId,
      strategy: existing,
      preferences: { p3: "lock" },
      localCorrections: [correction],
      csvProjectionOverrides: [csv],
      savedAt: "2026-07-26T12:00:00.000Z",
    });

    render(<StrategyBuilder draftId={draftId} league={league} />);
    await user.type(screen.getByLabelText("Player preference"), "Bijan Robinson");
    await user.click(screen.getByRole("button", { name: "Target player" }));
    await user.click(screen.getByRole("button", { name: "Enter draft room" }));

    expect(loadSession(draftId)).toEqual(expect.objectContaining({
      localCorrections: [correction],
      csvProjectionOverrides: [csv],
      preferences: { p3: "lock", "Bijan Robinson": "target" },
    }));
  });
});
