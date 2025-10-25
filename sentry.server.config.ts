import * as Sentry from "@sentry/nextjs";

import { RELEASE_TAG } from "./lib/release";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const enabled = (process.env.ENABLE_TELEMETRY ?? "true") !== "false" && Boolean(dsn);

Sentry.init({
  dsn,
  enabled,
  release: RELEASE_TAG,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.2,
});
