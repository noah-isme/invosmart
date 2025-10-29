import * as Sentry from "@sentry/nextjs";

import { getTelemetryDistinctId, trackEvent } from "@/lib/telemetry";

type WebVitalMetric = {
  name: string;
  value: number;
  delta?: number;
  id?: string;
  rating?: string;
};

type WebVitalCallback = (metric: WebVitalMetric) => void;

const BOT_PATTERN = /bot|crawler|spider|crawling/i;
const DEFAULT_SAMPLE_RATE = 0.2;

const parseSampleRate = (value: string | undefined | null) => {
  if (!value) return DEFAULT_SAMPLE_RATE;

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE;

  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;

  return parsed;
};

const envSampleRate = parseSampleRate(process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE);

const getOverrideSampleRate = () => {
  try {
    const globalOverride = (globalThis as { __INVOSMART_RUM_RATE__?: number | string }).__INVOSMART_RUM_RATE__;
    if (typeof globalOverride === "number" && Number.isFinite(globalOverride)) {
      return parseSampleRate(globalOverride.toString());
    }
    if (typeof globalOverride === "string") {
      return parseSampleRate(globalOverride);
    }

    if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
      const stored = window.localStorage.getItem("invosmart:rum-sample-rate");
      if (stored) {
        return parseSampleRate(stored);
      }
    }
  } catch {
    // ignore override parsing issues
  }

  return null;
};

const getSampleRate = () => {
  const override = getOverrideSampleRate();
  if (typeof override === "number" && override >= 0 && override <= 1) {
    return override;
  }

  return envSampleRate;
};

const isNavigatorBot = () => {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent ?? "";
  return BOT_PATTERN.test(ua);
};

const normaliseMetricValue = (metric: WebVitalMetric) => {
  if (metric.name === "CLS") {
    return Number(metric.value.toFixed(4));
  }

  if (metric.name === "INP" || metric.name === "FID") {
    return Number(metric.value.toFixed(2));
  }

  return Math.round(metric.value);
};

const getRoute = () => {
  if (typeof window === "undefined") return "unknown";

  return window.location.pathname || "unknown";
};

const getThemeMode = () => {
  if (typeof window === "undefined") return "unknown";

  const explicit =
    document.documentElement.dataset.theme ??
    document.documentElement.getAttribute("data-theme");

  if (explicit) {
    return explicit;
  }

  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }

    if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  }

  return "system";
};

const getDeviceContext = () => {
  if (typeof window === "undefined") return {} as Record<string, unknown>;

  const width = Math.round(window.innerWidth ?? 0);
  const height = Math.round(window.innerHeight ?? 0);
  const pixelRatio = Number(window.devicePixelRatio ?? 1);

  const category = width < 640 ? "mobile" : width < 1024 ? "tablet" : "desktop";

  return {
    viewport_width: width,
    viewport_height: height,
    device_pixel_ratio: Number.isFinite(pixelRatio) ? Number(pixelRatio.toFixed(2)) : 1,
    device_category: category,
  } satisfies Record<string, unknown>;
};

const getConnectionContext = () => {
  if (typeof navigator === "undefined") return {} as Record<string, unknown>;

  const connection = (navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      saveData?: boolean;
    };
  }).connection;

  if (!connection) return {} as Record<string, unknown>;

  return {
    network_effective_type: connection.effectiveType ?? null,
    network_downlink: connection.downlink ?? null,
    network_save_data: connection.saveData ?? false,
  } satisfies Record<string, unknown>;
};

const getReducedMotionPreference = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

const extractTraceIdFromSpan = (span: unknown) => {
  if (!span || typeof span !== "object") {
    return undefined;
  }

  const candidate = span as { spanContext?: () => { traceId?: string | undefined } | undefined };
  const context = typeof candidate.spanContext === "function" ? candidate.spanContext() : undefined;
  const traceId = context?.traceId;

  return typeof traceId === "string" ? traceId : undefined;
};

const getTraceId = () => {
  try {
    const sentryAny = Sentry as unknown as {
      getCurrentHub?: () => { getScope?: () => { getSpan?: () => unknown } };
      getActiveSpan?: () => unknown;
    };

    const hub = typeof sentryAny.getCurrentHub === "function" ? sentryAny.getCurrentHub() : undefined;
    const spanTraceId = extractTraceIdFromSpan(hub?.getScope?.()?.getSpan?.());
    if (spanTraceId) {
      return spanTraceId;
    }

    const activeSpan = typeof sentryAny.getActiveSpan === "function" ? sentryAny.getActiveSpan() : undefined;
    const activeTraceId = extractTraceIdFromSpan(activeSpan);
    if (activeTraceId) {
      return activeTraceId;
    }

    const globalTrace = (globalThis as { __INVOSMART_TRACE_ID__?: string }).__INVOSMART_TRACE_ID__;
    return globalTrace;
  } catch {
    return undefined;
  }
};

const getNavigationTimings = () => {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return null;
  }

  const navigationEntries = performance.getEntriesByType("navigation") as PerformanceEntry[];

  if (!navigationEntries?.length) {
    return null;
  }

  const entry = navigationEntries[0] as PerformanceNavigationTiming;

  return {
    navigation_type: entry.type,
    dom_content_loaded: Math.round(entry.domContentLoadedEventEnd),
    dom_complete: Math.round(entry.domComplete),
    response_end: Math.round(entry.responseEnd),
    request_start: Math.round(entry.requestStart),
    response_start: Math.round(entry.responseStart),
    load_event_end: Math.round(entry.loadEventEnd),
    transfer_size: entry.transferSize,
  } satisfies Record<string, unknown>;
};

const sharedProps = () => ({
  route: getRoute(),
  theme_mode: getThemeMode(),
  trace_id: getTraceId() ?? null,
  reduced_motion: getReducedMotionPreference(),
  distinct_id: getTelemetryDistinctId() ?? null,
  ...getDeviceContext(),
  ...getConnectionContext(),
});

const emitMetric = (metric: WebVitalMetric) => {
  void trackEvent("web_vital", {
    metric_name: metric.name,
    value: normaliseMetricValue(metric),
    raw_value: Number(metric.value.toFixed(4)),
    delta: metric.delta ? Number(metric.delta.toFixed(4)) : null,
    rating: metric.rating ?? null,
    metric_id: metric.id ?? null,
    ...sharedProps(),
  });
};

const emitNavigationTimings = () => {
  const timings = getNavigationTimings();
  if (!timings) return;

  void trackEvent("navigation_timing", {
    ...timings,
    ...sharedProps(),
  });
};

const registerVitals = async () => {
  const mod = await import("web-vitals" /* webpackChunkName: "web-vitals" */);

  const handlers = ([
    mod.onCLS,
    mod.onFCP,
    mod.onLCP,
    mod.onTTFB,
    mod.onINP ?? mod.onFID,
  ].filter((handler) => typeof handler === "function") as Array<
    (onReport: (metric: unknown) => void) => void
  >);

  handlers.forEach((handler) => {
    handler((metric) => {
      emitMetric(metric as WebVitalMetric);
    });
  });

  emitNavigationTimings();
};

let initialised = false;

export async function initRUM() {
  if (initialised || typeof window === "undefined") {
    return;
  }

  const sampleRate = getSampleRate();

  if (sampleRate <= 0) {
    initialised = true;
    return;
  }

  if (isNavigatorBot()) {
    initialised = true;
    return;
  }

  initialised = true;

  if (Math.random() >= sampleRate) {
    return;
  }

  try {
    await registerVitals();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Failed to initialise RUM", error);
    }
  }
}

export const __internal = {
  normaliseMetricValue,
  parseSampleRate,
  getSampleRate,
};

