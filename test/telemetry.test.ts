import { beforeEach, describe, expect, it } from "vitest";

import { __resetTelemetryForTests, initTelemetry, trackEvent } from "@/lib/telemetry";
import { posthogCapture, posthogInit } from "posthog-js";

describe("client telemetry", () => {
  beforeEach(() => {
    __resetTelemetryForTests();
    posthogCapture.mockClear();
    posthogInit.mockClear();
    process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = "true";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  });

  it("initializes PostHog once and captures events", () => {
    initTelemetry();
    expect(posthogInit).toHaveBeenCalledWith("phc_test", expect.any(Object));

    trackEvent("invoice_created", { amount: 120_000 });
    expect(posthogCapture).toHaveBeenCalledWith("invoice_created", { amount: 120_000 });
  });

  it("does not capture when telemetry disabled", () => {
    process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = "false";
    trackEvent("invoice_created");
    expect(posthogCapture).not.toHaveBeenCalled();
  });
});
