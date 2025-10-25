"use client";

import posthog from "posthog-js";

type TelemetryProperties = Record<string, unknown> | undefined;

const telemetryHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

const isTelemetryEnabled = () =>
  process.env.NEXT_PUBLIC_ENABLE_TELEMETRY !== "false" &&
  Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

let initialized = false;
let key: string | null = null;

export function initTelemetry() {
  if (initialized || !isTelemetryEnabled()) {
    return;
  }

  key = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? null;

  if (!key) {
    return;
  }

  posthog.init(key, {
    api_host: telemetryHost,
    capture_pageview: false,
    capture_pageleave: true,
    persistence: "localStorage+cookie",
  });

  initialized = true;
}

export function trackEvent(name: string, props?: TelemetryProperties) {
  if (!isTelemetryEnabled()) {
    return;
  }

  if (!initialized) {
    initTelemetry();
  }

  if (!initialized) {
    return;
  }

  posthog.capture(name, props);
}

export function flushTelemetry() {
  const maybeFlush = (posthog as unknown as { flush?: () => void }).flush;

  if (initialized && typeof maybeFlush === "function") {
    maybeFlush();
  }
}

export function telemetryStatus() {
  return { initialized, enabled: isTelemetryEnabled(), key } as const;
}

export function __resetTelemetryForTests() {
  initialized = false;
  key = null;
  posthog.reset();
}
