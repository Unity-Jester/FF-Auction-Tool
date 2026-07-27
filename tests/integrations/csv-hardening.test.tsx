import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createLeagueConfig } from "@/domain/league/defaults";
import { StrategyBuilder } from "@/features/strategy/components/strategy-builder";
import { parseProjectionCsv } from "@/integrations/projections/csv-provider";

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

describe("CSV import limits", () => {
  it("rejects more matched overrides than session storage accepts without hiding match problems", () => {
    const players = Array.from({ length: 2_002 }, (_, index) => ({
      playerId: `player-${index}`,
      name: `Player ${index}`,
      team: "CHI",
      positions: ["RB"] as const,
    }));
    const csv = [
      "player_id,name,team,position,rush_yd",
      ...players.slice(0, 2_001).map((player) =>
        `${player.playerId},${player.name},CHI,RB,1000`
      ),
      ",Missing Player,CHI,RB,1000",
      ",Player 2001,,RB,1000",
    ].join("\n");

    const result = parseProjectionCsv(csv, players);

    expect(result.matched).toHaveLength(2_001);
    expect(result.unmatched).toHaveLength(2);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.unsupported).toContainEqual(
      expect.objectContaining({
        reason:
          "CSV matches more than 2,000 players. Reduce it to 2,000 uniquely matched players or fewer.",
      }),
    );
  });

  it("checks the browser file size before reading or requesting the player list", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const file = new File(["x".repeat(1_000_001)], "oversized.csv", {
      type: "text/csv",
    });
    const text = vi.spyOn(file, "text");
    const user = userEvent.setup();
    render(
      <StrategyBuilder draftId="123456789012345678" league={league} />,
    );

    await user.upload(
      screen.getByLabelText("Projection CSV", { selector: "input" }),
      file,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The CSV exceeds the 1 MB file limit. Choose a smaller file.",
    );
    expect(
      screen.getByLabelText("Projection CSV", { selector: "input" }),
    ).toBeEnabled();
    expect(text).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
