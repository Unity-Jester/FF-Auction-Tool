import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
