// e2e NEXT_PUBLIC_* values and their fingerprint, shared by scripts/e2e-build.mjs
// and playwright.config.ts (via test/e2e/playwright.env.ts). Kept free of
// import.meta so Playwright's config loader can transpile it.
import { createHash } from "node:crypto";

const appPort = process.env.E2E_APP_PORT || "3000";

// NEXT_PUBLIC_* values are inlined at build time, so they must match the
// values the e2e runtime expects. Blank entries stop ambient values leaking in.
export const E2E_PUBLIC_ENV = {
  NEXT_PUBLIC_APP_URL: `http://localhost:${appPort}`,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_e2e",
  NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: "SB-Mid-client-e2e",
  NEXT_PUBLIC_ENABLE_TELEMETRY: "false",
  NEXT_PUBLIC_ENABLE_AI_OPTIMIZER: "",
  NEXT_PUBLIC_POSTHOG_KEY: "",
  NEXT_PUBLIC_POSTHOG_HOST: "",
  NEXT_PUBLIC_ADMIN_EMAILS: "",
  NEXT_PUBLIC_SENTRY_ENV: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
};

export function fingerprint(values = E2E_PUBLIC_ENV) {
  const sorted = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
