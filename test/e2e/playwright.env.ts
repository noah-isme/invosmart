// Single source of truth for the e2e environment: ports, URLs, secrets,
// persona identities and the env handed to every webServer process.
//
// Every provider and telemetry variable is set explicitly (an e2e placeholder,
// or a blank string where the integration must be absent) so ambient shell
// values can never leak into a test run. Next.js does not let `.env*` files
// override variables that are already defined, blank strings included.
import { E2E_PUBLIC_ENV } from "../../scripts/e2e-public-env.mjs";

const intFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} must be a TCP port, got "${raw}"`);
  }
  return value;
};

export const E2E_APP_PORT = intFromEnv("E2E_APP_PORT", 3000);
export const E2E_DB_PORT = intFromEnv("E2E_DB_PORT", 54329);
export const E2E_STUB_PORT = intFromEnv("E2E_STUB_PORT", 4010);

// The app runs on `localhost` (not 127.0.0.1): `__Host-` cookies are Secure and
// Playwright's APIRequestContext only sends Secure cookies to `localhost`.
export const E2E_APP_URL = `http://localhost:${E2E_APP_PORT}`;
// The database and the provider stub bind to 127.0.0.1 only.
export const E2E_STUB_URL = `http://127.0.0.1:${E2E_STUB_PORT}`;
export const E2E_DB_READY_URL = `http://127.0.0.1:${E2E_DB_PORT + 1}/ready`;
export const E2E_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres?connection_limit=1&pool_timeout=30`;
export const E2E_PLACEHOLDER_DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export const E2E_WORKSPACE_AUTH_MODE = process.env.E2E_WORKSPACE_AUTH_MODE === "compat" ? "compat" : "enforce";

// Fixed persona identities. Each run starts from a fresh in-memory database, so
// these addresses are unique per run and ADMIN_EMAILS can list platform-admin.
export const E2E_PERSONAS = {
  owner: "e2e-owner@invosmart.test",
  admin: "e2e-admin@invosmart.test",
  member: "e2e-member@invosmart.test",
  viewer: "e2e-viewer@invosmart.test",
  platformAdmin: "e2e-platform-admin@invosmart.test",
} as const;
export type E2ePersona = keyof typeof E2E_PERSONAS;
export const E2E_PERSONA_PASSWORD = "E2e-Persona-Passw0rd!";

// Secrets used by the app and by tests that forge signed webhooks or tokens.
export const E2E_SECRETS = {
  NEXTAUTH_SECRET: "e2e-nextauth-secret-0123456789abcdef0123456789abcdef",
  CRON_SECRET: "e2e-cron-secret",
  INVOICE_SHARE_SECRET: "e2e-invoice-share-secret",
  // 32 bytes, hex encoded (lib/team/secrets.ts).
  WORKSPACE_NOTIFICATION_ENCRYPTION_KEY: "e2e0".repeat(16),
  STRIPE_SECRET_KEY: "sk_test_e2e",
  STRIPE_WEBHOOK_SECRET: "whsec_e2e",
  MIDTRANS_SERVER_KEY: "SB-Mid-server-e2e",
  MIDTRANS_CLIENT_KEY: "SB-Mid-client-e2e",
  RESEND_API_KEY: "re_e2e",
  // Standard Webhooks secret: "whsec_" + base64.
  RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from("e2e-resend-webhook-secret").toString("base64")}`,
  OPENAI_API_KEY: "sk-e2e",
} as const;

// Variables that must be absent during a local run. Kept blank, never omitted.
export const E2E_BLANK_ENV = {
  GEMINI_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  KV_REST_API_URL: "",
  KV_REST_API_TOKEN: "",
  SLACK_WEBHOOK_URL: "",
  DISCORD_WEBHOOK_URL: "",
  SENTRY_DSN: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
  SENTRY_AUTH_TOKEN: "",
  SENTRY_ENV: "",
  POSTHOG_API_KEY: "",
  POSTHOG_PROJECT_ID: "",
  NEXT_PUBLIC_POSTHOG_KEY: "",
  CLOUDINARY_URL: "",
  FEDERATION_ENDPOINTS: "",
  FEDERATION_PRIVATE_KEY: "",
  FEDERATION_PUBLIC_KEY: "",
  FEDERATION_TOKEN_SECRET: "",
  VERCEL: "",
  VERCEL_ENV: "",
  VERCEL_URL: "",
} as const;

/** Full env for the app server in the default (DB + stub) mode. */
export const e2eAppEnv = (): Record<string, string> => ({
  ...E2E_BLANK_ENV,
  // NEXT_PUBLIC_* are inlined at build time; repeated at runtime for server code.
  ...E2E_PUBLIC_ENV,
  NODE_ENV: "production",
  PORT: String(E2E_APP_PORT),
  DATABASE_URL: E2E_DATABASE_URL,
  DIRECT_URL: E2E_DATABASE_URL,
  DATABASE_POOL_MAX: "1",
  NEXTAUTH_URL: E2E_APP_URL,
  NEXTAUTH_SECRET: E2E_SECRETS.NEXTAUTH_SECRET,
  CRON_SECRET: E2E_SECRETS.CRON_SECRET,
  INVOICE_SHARE_SECRET: E2E_SECRETS.INVOICE_SHARE_SECRET,
  ADMIN_EMAILS: E2E_PERSONAS.platformAdmin,
  WORKSPACE_NOTIFICATION_ENCRYPTION_KEY: E2E_SECRETS.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY,
  WORKSPACE_AUTH_MODE: E2E_WORKSPACE_AUTH_MODE,
  STRIPE_SECRET_KEY: E2E_SECRETS.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: E2E_SECRETS.STRIPE_WEBHOOK_SECRET,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_e2e",
  MIDTRANS_SERVER_KEY: E2E_SECRETS.MIDTRANS_SERVER_KEY,
  MIDTRANS_CLIENT_KEY: E2E_SECRETS.MIDTRANS_CLIENT_KEY,
  NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: E2E_SECRETS.MIDTRANS_CLIENT_KEY,
  RESEND_API_KEY: E2E_SECRETS.RESEND_API_KEY,
  RESEND_FROM_EMAIL: "InvoSmart E2E <billing@invosmart.test>",
  RESEND_WEBHOOK_SECRET: E2E_SECRETS.RESEND_WEBHOOK_SECRET,
  RESEND_BASE_URL: `${E2E_STUB_URL}/resend`,
  OPENAI_API_KEY: E2E_SECRETS.OPENAI_API_KEY,
  OPENAI_BASE_URL: `${E2E_STUB_URL}/openai/v1`,
  // Read by the Stripe/Midtrans seams added in Step 6; ignored by the app until then.
  INVOSMART_E2E_PROVIDER_BASE_URL: E2E_STUB_URL,
  POSTHOG_API_HOST: `${E2E_STUB_URL}/posthog`,
  UPTIME_MONITORED_ENDPOINTS: `${E2E_APP_URL}/api/health,${E2E_APP_URL}/api/invoices`,
  ENABLE_TELEMETRY: "false",
  NEXT_PUBLIC_ENABLE_TELEMETRY: "false",
  ENABLE_RECEIPTS: "true",
  ENABLE_RECEIPT_STAMPS: "true",
  ENABLE_AI_OPTIMIZER: "true",
  ENABLE_AI_OPTIMIZER_LOCAL: "true",
  ENABLE_AI_OPTIMIZER_GLOBAL: "true",
  ENABLE_AI_LEARNING: "true",
  ENABLE_AI_GOVERNANCE: "true",
  ENABLE_AI_AUTONOMY: "true",
  ENABLE_AI_ORCHESTRATION: "memory",
  ENABLE_AI_FEDERATION: "false",
  AI_SA_MAX_AUTOPUBLISH_PER_DAY: "1",
});

// Provider credentials and base URLs blanked in contract-only mode.
const PROVIDER_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "MIDTRANS_SERVER_KEY",
  "MIDTRANS_CLIENT_KEY",
  "NEXT_PUBLIC_MIDTRANS_CLIENT_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET",
  "RESEND_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "INVOSMART_E2E_PROVIDER_BASE_URL",
  "POSTHOG_API_HOST",
] as const;

/**
 * Env for the no-DB contract gate (E2E_CONTRACT_ONLY=1): app server only, a
 * placeholder DATABASE_URL that is never reachable, every provider key blank.
 */
export const e2eContractAppEnv = (): Record<string, string> => {
  const env = e2eAppEnv();
  for (const key of PROVIDER_KEYS) env[key] = "";
  env.DATABASE_URL = E2E_PLACEHOLDER_DATABASE_URL;
  env.DIRECT_URL = E2E_PLACEHOLDER_DATABASE_URL;
  env.UPTIME_MONITORED_ENDPOINTS = `${E2E_APP_URL}/api/health`;
  return env;
};
