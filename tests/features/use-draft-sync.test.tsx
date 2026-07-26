import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/domain/draft/types";
import { useDraftSync } from "@/features/draft-session/use-draft-sync";

const response = (status: DraftSnapshot["status"]): DraftSnapshot => ({
  draftId: "draft-1", status, type: "auction", league: {} as DraftSnapshot["league"], teams: [], purchases: [], lastUpdatedAt: "2026-07-25T12:00:00.000Z",
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useDraftSync", () => {
  it("polls active drafts every three seconds and stops completed drafts", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response("drafting"));
    const { result, rerender } = renderHook(({ draftId }) => useDraftSync(draftId, fetcher), { initialProps: { draftId: "draft-1" }, wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data?.status).toBe("drafting");
    await act(async () => { await vi.advanceTimersByTimeAsync(3_001); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValue(response("complete"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_001); });
    expect(result.current.data?.status).toBe("complete");
    rerender({ draftId: "draft-1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps the last snapshot and exposes stale status after a failed refresh", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response("drafting")).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useDraftSync("draft-1", fetcher), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_001); });
    expect(result.current.syncStatus).toBe("stale");
    expect(result.current.data?.draftId).toBe("draft-1");
    expect(result.current.retry).toEqual(expect.any(Function));
  });

  it("backs off initial failures before a first successful snapshot", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(response("drafting"));
    renderHook(() => useDraftSync("draft-1", fetcher), { wrapper });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not request an invalid draft ID", () => {
    const fetcher = vi.fn();
    renderHook(() => useDraftSync("not valid", fetcher), { wrapper });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
