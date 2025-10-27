import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetTelemetryForTests, initTelemetry, trackEvent } from "@/lib/telemetry";
import posthog from "posthog-js";

describe("client telemetry", () => {
  beforeEach(() => {
    __resetTelemetryForTests();
  (posthog.capture as unknown as { mockClear?: () => void })?.mockClear?.();
  (posthog.init as unknown as { mockClear?: () => void })?.mockClear?.();
    process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = "true";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  });

  it("initializes PostHog once and captures events", () => {
    initTelemetry();
  expect(posthog.init).toHaveBeenCalledWith("phc_test", expect.any(Object));

    trackEvent("invoice_created", { amount: 120_000 });
  expect(posthog.capture).toHaveBeenCalledWith("invoice_created", { amount: 120_000 });
  });

  it("does not capture when telemetry disabled", () => {
    process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = "false";
    trackEvent("invoice_created");
  expect(posthog.capture).not.toHaveBeenCalled();
  });
});
