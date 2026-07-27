import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLeagueConfig } from "@/domain/league/defaults";
import { StrategyBuilder } from "@/features/strategy/components/strategy-builder";
import { defaultStrategy } from "@/features/strategy/default-strategies";
import type { SavedStrategy } from "@/persistence/saved-strategy-repository";

const repositoryForCurrentSession = vi.fn();
vi.mock("@/persistence/strategy-repository-selector", () => ({
  repositoryForCurrentSession: (...args: unknown[]) =>
    repositoryForCurrentSession(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const league = createLeagueConfig({
  teams: 12,
  budget: 200,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
  bench: 6,
  flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
  receptionPoints: 1,
});

describe("StrategyBuilder auth transitions", () => {
  beforeEach(() => {
    repositoryForCurrentSession.mockReset();
    window.localStorage.clear();
  });

  it("does not show a stale strategy after the active account changes", async () => {
    let resolveOld: (records: SavedStrategy[]) => void = () => {};
    const oldRecords = new Promise<SavedStrategy[]>((resolve) => {
      resolveOld = resolve;
    });
    repositoryForCurrentSession
      .mockResolvedValueOnce({
        list: () => oldRecords,
        save: vi.fn(),
        remove: vi.fn(),
      })
      .mockResolvedValueOnce({
        list: async () => [],
        save: vi.fn(),
        remove: vi.fn(),
      });

    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    act(() => window.dispatchEvent(new Event("strategy-auth-change")));
    await waitFor(() => expect(repositoryForCurrentSession).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("strategy-auth-change")));
    await waitFor(() => expect(repositoryForCurrentSession).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveOld([{
        id: "3ca44572-fbef-44c7-9b93-334f44632a44",
        name: "Previous user secret",
        strategy: defaultStrategy(league),
        createdAt: "2026-07-26T12:00:00.000Z",
        updatedAt: "2026-07-26T12:00:00.000Z",
      }]);
      await Promise.resolve();
    });

    expect(screen.queryByText("Previous user secret")).not.toBeInTheDocument();
  });

  it("disables conflicting controls while a save is pending", async () => {
    let finishSave: () => void = () => {};
    const saving = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const record: SavedStrategy = {
      id: "3ca44572-fbef-44c7-9b93-334f44632a44",
      name: "Existing plan",
      strategy: defaultStrategy(league),
      createdAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z",
    };
    repositoryForCurrentSession.mockResolvedValue({
      list: async () => [record],
      save: () => saving,
      remove: vi.fn(),
    });
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    act(() => window.dispatchEvent(new Event("strategy-auth-change")));
    await screen.findByText("Existing plan");
    await user.type(screen.getByLabelText("Saved strategy name"), "New plan");
    await user.click(screen.getByRole("button", { name: "Save named strategy" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load Existing plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Existing plan" })).toBeDisabled();
    await act(async () => finishSave());
  });

  it("clears stale pending controls when the active account changes", async () => {
    const saving = new Promise<void>(() => {});
    const oldRepository = {
      list: async () => [],
      save: () => saving,
      remove: vi.fn(),
    };
    repositoryForCurrentSession
      .mockResolvedValueOnce(oldRepository)
      .mockResolvedValueOnce(oldRepository)
      .mockResolvedValueOnce({
        list: async () => [],
        save: vi.fn(),
        remove: vi.fn(),
      });
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    act(() => window.dispatchEvent(new Event("strategy-auth-change")));
    await waitFor(() => expect(repositoryForCurrentSession).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("Saved strategy name"), "Old account plan");
    await user.click(screen.getByRole("button", { name: "Save named strategy" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    act(() => window.dispatchEvent(new Event("strategy-auth-change")));

    expect(
      await screen.findByRole("button", { name: "Save named strategy" }),
    ).toBeEnabled();
  });

  it("disables conflicting controls while a remove is pending", async () => {
    let finishRemove: () => void = () => {};
    const removing = new Promise<void>((resolve) => {
      finishRemove = resolve;
    });
    const record: SavedStrategy = {
      id: "3ca44572-fbef-44c7-9b93-334f44632a44",
      name: "Existing plan",
      strategy: defaultStrategy(league),
      createdAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z",
    };
    repositoryForCurrentSession.mockResolvedValue({
      list: async () => [record],
      save: vi.fn(),
      remove: () => removing,
    });
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    act(() => window.dispatchEvent(new Event("strategy-auth-change")));
    await screen.findByText("Existing plan");
    await user.click(screen.getByRole("button", { name: "Remove Existing plan" }));

    expect(screen.getByRole("button", { name: "Save named strategy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load Existing plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Removing Existing plan" }))
      .toBeDisabled();
    await act(async () => finishRemove());
  });

  it("shows safe cloud quarantine warnings without hiding valid strategies", async () => {
    const record: SavedStrategy = {
      id: "3ca44572-fbef-44c7-9b93-334f44632a44",
      name: "Valid cloud plan",
      strategy: defaultStrategy(league),
      createdAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z",
    };
    repositoryForCurrentSession.mockResolvedValue({
      list: async () => [record],
      save: vi.fn(),
      remove: vi.fn(),
      getWarnings: () => [
        "Some cloud strategies were skipped because they were invalid.",
      ],
    });
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    act(() => window.dispatchEvent(new Event("strategy-auth-change")));

    expect(await screen.findByText("Valid cloud plan")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some cloud strategies were skipped because they were invalid.",
    );
  });

  it("shows the stable cloud quota message", async () => {
    repositoryForCurrentSession.mockResolvedValue({
      list: async () => [],
      save: async () => {
        throw new Error("You can save up to 50 named strategies.");
      },
      remove: vi.fn(),
    });
    const user = userEvent.setup();
    render(<StrategyBuilder draftId="123456789012345678" league={league} />);
    act(() => window.dispatchEvent(new Event("strategy-auth-change")));
    await user.type(screen.getByLabelText("Saved strategy name"), "Plan 51");
    await user.click(screen.getByRole("button", { name: "Save named strategy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can save up to 50 named strategies.",
    );
  });
});
