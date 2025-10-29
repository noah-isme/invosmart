"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

export type PrefetchCandidate = {
  route: string;
  confidence: number;
};

type UsePredictivePrefetchOptions = {
  enabled?: boolean;
  minConfidence?: number;
  idleTimeout?: number;
};

const defaultIdleTimeout = 1500;

type ExtendedWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const scheduleIdleCallback = (cb: () => void, timeout: number) => {
  if (typeof window === "undefined") return () => undefined;

  const extendedWindow = window as ExtendedWindow;

  if (typeof extendedWindow.requestIdleCallback === "function") {
    const idleId = extendedWindow.requestIdleCallback(() => cb(), { timeout });
    return () => {
      extendedWindow.cancelIdleCallback?.(idleId);
    };
  }

  const timer = window.setTimeout(cb, timeout);
  return () => window.clearTimeout(timer);
};

export const usePredictivePrefetch = (
  candidates: PrefetchCandidate[],
  { enabled = true, minConfidence = 0.7, idleTimeout = defaultIdleTimeout }: UsePredictivePrefetchOptions = {},
) => {
  const router = useRouter();
  const prefetched = useRef(new Set<string>());

  const eligibleRoutes = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.confidence >= minConfidence)
        .map((candidate) => (candidate.route.startsWith("/") ? candidate.route : `/${candidate.route}`)),
    [candidates, minConfidence],
  );

  useEffect(() => {
    if (!enabled || eligibleRoutes.length === 0) {
      return;
    }

    let cancelIdle: () => void = () => {};

    const runPrefetch = () => {
      eligibleRoutes.forEach((route) => {
        if (prefetched.current.has(route)) return;
        prefetched.current.add(route);
        try {
          const result = router.prefetch(route);
          void Promise.resolve(result).catch((error) => {
            console.warn("Prefetch failed", error);
            prefetched.current.delete(route);
          });
        } catch (error) {
          console.warn("Prefetch failed", error);
          prefetched.current.delete(route);
        }
      });
    };

    cancelIdle = scheduleIdleCallback(runPrefetch, idleTimeout);

    return () => {
      cancelIdle();
    };
  }, [enabled, eligibleRoutes, idleTimeout, router]);
};
