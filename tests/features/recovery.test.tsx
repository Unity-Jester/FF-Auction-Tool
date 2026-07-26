import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecoveryPanel } from "@/features/errors/components/recovery-panel";
import { Methodology } from "@/features/help/components/methodology";

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
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
