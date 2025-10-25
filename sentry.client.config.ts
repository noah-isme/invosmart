import * as Sentry from "@sentry/nextjs";

import { RELEASE_TAG } from "./lib/release";

const enabled =
  process.env.NEXT_PUBLIC_ENABLE_TELEMETRY !== "false" && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled,
  release: RELEASE_TAG,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
});
