import { PostHog } from "posthog-node";

import { RELEASE_TAG } from "@/lib/release";

const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.POSTHOG_API_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

const telemetryEnabled =
  (process.env.ENABLE_TELEMETRY ?? process.env.NEXT_PUBLIC_ENABLE_TELEMETRY ?? "true") !== "false" &&
  Boolean(key);

let client: PostHog | null = null;

function getClient() {
  if (!telemetryEnabled || !key) {
    return null;
  }

  if (!client) {
    client = new PostHog(key, {
      host,
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return client;
}

export async function captureServerEvent(
  event: string,
  properties?: Record<string, unknown>,
  options?: { distinctId?: string },
) {
  const instance = getClient();
  if (!instance) {
    return;
  }

  instance.capture({
    event,
    distinctId: options?.distinctId ?? "system",
    properties: {
      release: RELEASE_TAG,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? "development",
      ...properties,
    },
  });
}

export async function captureServerMetric(
  metric: string,
  value: number,
  properties?: Record<string, unknown>,
) {
  await captureServerEvent(metric, { value, ...properties });
}

export async function shutdownTelemetry() {
  if (client) {
    await client.shutdownAsync();
    client = null;
  }
}
