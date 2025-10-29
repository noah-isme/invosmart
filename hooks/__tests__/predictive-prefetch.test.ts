import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePredictivePrefetch } from "@/hooks/usePredictivePrefetch";

const prefetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: prefetchMock,
  }),
}));

describe("usePredictivePrefetch", () => {
  const originalRequestIdle = globalThis.requestIdleCallback;
  const originalCancelIdle = globalThis.cancelIdleCallback;

  beforeEach(() => {
    prefetchMock.mockReset();
    (globalThis as unknown as { requestIdleCallback: typeof window.requestIdleCallback }).requestIdleCallback = (
      callback: IdleRequestCallback,
    ) => {
      const deadline: IdleDeadline = {
        didTimeout: false,
        timeRemaining: () => 50,
      };
      callback(deadline);
      return 1;
    };
    (globalThis as unknown as { cancelIdleCallback: typeof window.cancelIdleCallback }).cancelIdleCallback = vi.fn();
  });

  afterEach(() => {
    globalThis.requestIdleCallback = originalRequestIdle;
    globalThis.cancelIdleCallback = originalCancelIdle;
  });

  it("prefetches eligible routes when enabled", async () => {
    await act(async () => {
      renderHook(() =>
        usePredictivePrefetch(
          [
            { route: "/app/dashboard", confidence: 0.9 },
            { route: "/app/settings", confidence: 0.65 },
          ],
          { enabled: true },
        ),
      );
    });

    expect(prefetchMock).toHaveBeenCalledTimes(1);
    expect(prefetchMock).toHaveBeenCalledWith("/app/dashboard");
  });

  it("skips prefetch when disabled or confidence too low", async () => {
    await act(async () => {
      renderHook(() =>
        usePredictivePrefetch(
          [
            { route: "/app/help", confidence: 0.5 },
            { route: "/app/about", confidence: 0.4 },
          ],
          { enabled: true },
        ),
      );
    });

    expect(prefetchMock).not.toHaveBeenCalled();

    await act(async () => {
      renderHook(() =>
        usePredictivePrefetch(
          [{ route: "/app/invoices", confidence: 0.9 }],
          { enabled: false },
        ),
      );
    });

    expect(prefetchMock).not.toHaveBeenCalled();
  });
});
