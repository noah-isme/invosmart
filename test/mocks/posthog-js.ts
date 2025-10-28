import { vi } from "vitest";

export const posthogInit = vi.fn();
export const posthogCapture = vi.fn();
export const posthogFlush = vi.fn();
export const posthogReset = vi.fn();

const posthog = {
  init: posthogInit,
  capture: posthogCapture,
  flush: posthogFlush,
  reset: posthogReset,
};

if (typeof globalThis !== "undefined") {
  (globalThis as { __POSTHOG_CLIENT__?: typeof posthog }).__POSTHOG_CLIENT__ = posthog;
}

export default posthog;
