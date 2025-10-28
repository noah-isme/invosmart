type TelemetryProperties = Record<string, unknown> | undefined;

type PosthogClient = {
  init?: (key: string, options?: Record<string, unknown>) => void;
  capture?: (event: string, props?: TelemetryProperties) => void;
  flush?: () => void;
  reset?: () => void;
};

type PosthogModule = { default?: PosthogClient } & PosthogClient;

type NodeRequire = (id: string) => unknown;

const telemetryHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

const isTelemetryEnabled = () =>
  process.env.NEXT_PUBLIC_ENABLE_TELEMETRY !== "false" &&
  Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

let initialized = false;
let key: string | null = null;
let posthogClient: PosthogClient | null = null;

const loadPosthogModule = (): PosthogModule | Promise<PosthogModule> => {
  const globalClient = (globalThis as { __POSTHOG_CLIENT__?: PosthogModule })
    .__POSTHOG_CLIENT__;
  if (globalClient) {
    return globalClient;
  }

  if (process.env.NODE_ENV === "test") {
    try {
      const maybeRequire: NodeRequire | undefined =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any)?.require;
      if (maybeRequire) {
        return maybeRequire("posthog-js") as PosthogModule;
      }
      const evaluatedRequire = new Function("return require") as () => NodeRequire;
      const resolvedRequire = evaluatedRequire();
      return resolvedRequire("posthog-js") as PosthogModule;
    } catch {
      // fall back to dynamic import
    }
  }

  return import("posthog-js");
};

// Lazy-initialize posthog so this module can be imported from server code
// without pulling client-only side-effects into the server bundle.
export function initTelemetry(): Promise<void> {
  if (initialized || !isTelemetryEnabled()) {
    return Promise.resolve();
  }

  key = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? null;
  if (!key) {
    return Promise.resolve();
  }

  const moduleResult = loadPosthogModule();

  const handleModule = (mod: PosthogModule) => {
    const client = mod.default ?? mod;
    if (!client?.init) {
      posthogClient = null;
      initialized = false;
      return;
    }

    try {
      client.init(key as string, {
        api_host: telemetryHost,
        capture_pageview: false,
        capture_pageleave: true,
        persistence: "localStorage+cookie",
      });
      posthogClient = client;
      initialized = true;
    } catch {
      posthogClient = null;
      initialized = false;
    }
  };

  if (moduleResult instanceof Promise) {
    return moduleResult
      .then((mod) => {
        handleModule(mod);
      })
      .catch(() => {
        posthogClient = null;
        initialized = false;
      });
  }

  handleModule(moduleResult);
  return Promise.resolve();
}

export async function trackEvent(name: string, props?: TelemetryProperties) {
  if (!isTelemetryEnabled()) return;

  if (!initialized) {
    await initTelemetry();
  }

  if (!initialized || !posthogClient) return;

  posthogClient.capture?.(name, props);
}

export async function flushTelemetry() {
  if (!initialized || !posthogClient) return;

  const maybeFlush = posthogClient.flush;
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
    posthogClient.reset?.();
  } catch {
    // ignore
  }

  posthogClient = null;
}
