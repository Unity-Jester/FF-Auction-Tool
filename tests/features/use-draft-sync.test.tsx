import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/domain/draft/types";
import { createLeagueConfig } from "@/domain/league/defaults";
import { useDraftSync } from "@/features/draft-session/use-draft-sync";

const response = (status: DraftSnapshot["status"]): DraftSnapshot => ({
  draftId: "draft-1",
  status,
  type: "auction",
  league: createLeagueConfig({
    teams: 2,
    budget: 200,
    starters: { QB: 1, RB: 1, WR: 1, TE: 1, K: 0, DEF: 0 },
    bench: 1,
    flex: [],
    receptionPoints: 0.5,
  }),
  teams: [
    { rosterId: 1, name: "One", remainingBudget: 200, openSlots: 5, playerIds: [] },
    { rosterId: 2, name: "Two", remainingBudget: 200, openSlots: 5, playerIds: [] },
  ],
  purchases: [],
  lastUpdatedAt: "2026-07-25T12:00:00.000Z",
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

  it("does not resume polling when a completed draft manual refresh fails", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response("complete"))
      .mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useDraftSync("draft-1", fetcher), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await act(async () => { await result.current.retry(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats a malformed successful response as stale and retains the last valid snapshot", async () => {
    vi.useFakeTimers();
    const valid = response("drafting");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(valid)
      .mockResolvedValueOnce({ ...valid, status: "unknown" });
    const { result } = renderHook(() => useDraftSync("draft-1", fetcher), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const lastValidSnapshot = result.current.data;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_001); });

    expect(result.current.syncStatus).toBe("stale");
    expect(result.current.data).toBe(lastValidSnapshot);
  });

  it("keeps draft content identity while exposing the newest synchronization time", async () => {
    vi.useFakeTimers();
    const initial = response("drafting");
    const refreshed = {
      ...response("drafting"),
      lastUpdatedAt: "2026-07-25T12:00:03.000Z",
    };
    const fetcher = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(refreshed);
    const { result } = renderHook(() => useDraftSync("draft-1", fetcher), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const draftState = result.current.data;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_001); });

    expect(result.current.data).toBe(draftState);
    expect(result.current.lastUpdatedAt).toBe("2026-07-25T12:00:03.000Z");
  });

  it("backs off initial failures before a first successful snapshot", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
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
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not request an invalid draft ID", () => {
    const fetcher = vi.fn();
    renderHook(() => useDraftSync("not valid", fetcher), { wrapper });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("isolates failure backoff when an older draft request finishes after a switch", async () => {
    vi.useFakeTimers();
    const oldDraft = deferred<unknown>();
    let newDraftCalls = 0;
    const fetcher = vi.fn((draftId: string) => {
      if (draftId === "draft-1") return oldDraft.promise;
      newDraftCalls += 1;
      return Promise.reject(new Error("offline"));
    });
    const { result, rerender } = renderHook(
      ({ draftId }) => useDraftSync(draftId, fetcher),
      { initialProps: { draftId: "draft-1" }, wrapper },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rerender({ draftId: "draft-2" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(newDraftCalls).toBe(1);

    await act(async () => {
      oldDraft.resolve(response("drafting"));
      await Promise.resolve();
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.syncStatus).toBe("offline");

    await act(async () => { await vi.advanceTimersByTimeAsync(5_001); });
    expect(newDraftCalls).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(newDraftCalls).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
    expect(newDraftCalls).toBe(3);
  });

  it("passes an abort signal and cancels an in-flight request on unmount", async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_draftId: string, signal?: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<unknown>(() => undefined);
    });
    const { unmount } = renderHook(() => useDraftSync("draft-1", fetcher), {
      wrapper,
    });
    await act(async () => { await Promise.resolve(); });

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });
});
