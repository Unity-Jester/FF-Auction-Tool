import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecoveryPanel } from "@/features/errors/components/recovery-panel";
import { Methodology } from "@/features/help/components/methodology";
import { SyncStatus } from "@/features/draft-room/components/sync-status";
import { readFileSync } from "node:fs";
import axe from "axe-core";

describe("transparent recovery and help", () => {
  it("turns stable upstream codes into safe guidance while retaining the known board", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<RecoveryPanel code="RATE_LIMITED" lastUpdatedAt="2026-07-25T12:34:00.000Z" onRetry={retry} />);

    expect(screen.getByText(/Sleeper is limiting requests/i)).toBeInTheDocument();
    expect(screen.getByText(/Last successful update: Jul 25/i)).toBeInTheDocument();
    expect(screen.getByText(/last known board and values remain visible/i)).toBeInTheDocument();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(retry).toHaveBeenCalledOnce();
  });

  it("opens accessible methodology help and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<Methodology projectionSource="Sleeper projections" projectionStale={false} />);
    const trigger = screen.getByRole("button", { name: /how values work/i });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: /how values work/i })).toBeInTheDocument();
    expect(screen.getByText(/replacement levels and VORP/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close help/i })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: /close help/i })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: /close help/i })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps polling timestamps outside the polite status region", () => {
    const { rerender } = render(<SyncStatus status="fresh" lastUpdatedAt="2026-07-25T12:00:00Z" onRetry={vi.fn()} />);
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Fresh");
    expect(live).not.toHaveTextContent("Updated");
    rerender(<SyncStatus status="fresh" lastUpdatedAt="2026-07-25T12:00:03Z" onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Fresh");
    expect(screen.getByText(/Updated Jul 25/)).not.toHaveAttribute("aria-live");
  });

  it("keeps the skip link above sticky draft controls", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.skip-link[^}]*z-index:\s*(?:[4-9]\d|\d{3,})/s);
    expect(css).toContain("@media (forced-colors: active)");
  });

  it("does not hide league information at tablet widths or nest page mains", () => {
    const css = readFileSync("src/features/draft-room/draft-room.module.css", "utf8");
    expect(css).not.toMatch(/max-width:\s*1100px[^}]*\.leagueRegion\s*\{\s*display:\s*none/s);
    for (const path of ["src/app/draft/[draftId]/setup/page.tsx", "src/app/draft/[draftId]/strategy/page.tsx"])
      expect(readFileSync(path, "utf8")).not.toContain("<main");
  });

  it("passes automated accessibility checks for recovery and help", async () => {
    const user = userEvent.setup();
    const { container } = render(<>
      <RecoveryPanel code="STORAGE" lastUpdatedAt={null} />
      <Methodology projectionSource="Sleeper projections" projectionStale={false} />
    </>);
    await user.click(screen.getByRole("button", { name: /how values work/i }));
    const result = await axe.run(container);
    expect(result.violations).toEqual([]);
  });
});
