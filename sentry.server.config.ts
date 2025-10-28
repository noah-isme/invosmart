import * as Sentry from "@sentry/nextjs";

import { RELEASE_TAG } from "./lib/release";

const enabled = process.env.ENABLE_TELEMETRY !== "false" && Boolean(process.env.SENTRY_DSN);

if (typeof Sentry.init === "function") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled,
    release: RELEASE_TAG,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
