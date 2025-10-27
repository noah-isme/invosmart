type TelemetryProperties = Record<string, unknown> | undefined;

const telemetryHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

const isTelemetryEnabled = () =>
  process.env.NEXT_PUBLIC_ENABLE_TELEMETRY !== "false" &&
  Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

let initialized = false;
let key: string | null = null;
let posthogClient: unknown | null = null;

// Lazy-initialize posthog so this module can be imported from server code
// without pulling client-only side-effects into the server bundle.
export async function initTelemetry() {
  if (initialized || !isTelemetryEnabled()) return;

  key = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? null;
  if (!key) return;

  // dynamic import to avoid accessing `window` at module-eval time
  const mod = await import("posthog-js");
  // default export
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posthogClient = (mod as any).default ?? (mod as any);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (posthogClient as any).init(key, {
      api_host: telemetryHost,
      capture_pageview: false,
      capture_pageleave: true,
      persistence: "localStorage+cookie",
    });

    initialized = true;
  } catch (err) {
    // If initialization fails in the runtime environment, disable telemetry silently.
    posthogClient = null;
    initialized = false;
  }
}

export async function trackEvent(name: string, props?: TelemetryProperties) {
  if (!isTelemetryEnabled()) return;

  if (!initialized) {
    await initTelemetry();
  }

  if (!initialized || !posthogClient) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (posthogClient as any).capture(name, props);
}

export async function flushTelemetry() {
  if (!initialized || !posthogClient) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeFlush = (posthogClient as any).flush;
  if (typeof maybeFlush === "function") {
    try {
      maybeFlush();
    } catch {
      // ignore
    }
  }
}

export function telemetryStatus() {
  return { initialized, enabled: isTelemetryEnabled(), key } as const;
}

export async function __resetTelemetryForTests() {
  initialized = false;
  key = null;

  if (!posthogClient) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (posthogClient as any).reset();
  } catch {
    // ignore
  }

  posthogClient = null;
}
