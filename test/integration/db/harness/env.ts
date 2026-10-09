// Pure helpers shared by the integration globalSetup and setupFiles.
// Kept free of side effects so the guard can be unit tested.
import { assertE2eDatabaseUrl } from "../../../e2e/support/db/guard.mjs";
import { e2eAppEnv } from "../../../e2e/playwright.env";

/** The integration layer owns its own pglite-server, ten ports above the app suite's. */
export const INTEGRATION_DB_PORT_OFFSET = 10;

type Env = Record<string, string | undefined>;

export const integrationDbPort = (env: Env = process.env): number => {
  const raw = env.E2E_DB_PORT;
  const base = raw === undefined || raw === "" ? 54329 : Number(raw);
  if (!Number.isInteger(base) || base <= 0 || base + INTEGRATION_DB_PORT_OFFSET + 1 > 65535) {
    throw new Error(`E2E_DB_PORT must be a TCP port, got "${raw}"`);
  }
  return base + INTEGRATION_DB_PORT_OFFSET;
};

export const integrationDatabaseUrl = (port: number): string =>
  `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pool_timeout=30`;

/**
 * Validates the injected database URL before anything can connect to it:
 * loopback host, the integration port (E2E_DB_PORT+10, which must also be the
 * port globalSetup reported) and a single-connection pool.
 */
export const assertIntegrationDatabaseUrl = (
  url: unknown,
  injectedPort: unknown,
  env: Env = process.env,
): string => {
  const expectedPort = integrationDbPort(env);
  if (Number(injectedPort) !== expectedPort) {
    throw new Error(
      `integration guard: injected port ${String(injectedPort)} is not E2E_DB_PORT+${INTEGRATION_DB_PORT_OFFSET} (${expectedPort})`,
    );
  }
  const parsed = assertE2eDatabaseUrl(url as string, expectedPort, "injected DATABASE_URL");
  if (parsed.searchParams.get("connection_limit") !== "1") {
    throw new Error("integration guard: injected DATABASE_URL must set connection_limit=1");
  }
  return url as string;
};

/** Loopback-only check for the injected provider stub URL. */
export const assertLoopbackStubUrl = (url: unknown): string => {
  if (typeof url !== "string" || url === "") throw new Error("integration guard: stub URL is empty");
  const { hostname, protocol } = new URL(url);
  if (protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw new Error(`integration guard: stub URL ${url} is not a loopback http URL`);
  }
  return url;
};

/**
 * Explicit env for the test worker: the app suite's env (every provider and
 * telemetry variable set or blanked) with the injected database and stub
 * URLs. NODE_ENV stays "test" (owned by Vitest); PORT is irrelevant here.
 */
export const buildIntegrationEnv = (databaseUrl: string, stubUrl: string): Record<string, string> => {
  const env = e2eAppEnv();
  delete env.NODE_ENV;
  delete env.PORT;
  return {
    ...env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    RESEND_BASE_URL: `${stubUrl}/resend`,
    OPENAI_BASE_URL: `${stubUrl}/openai/v1`,
    INVOSMART_E2E_PROVIDER_BASE_URL: stubUrl,
    POSTHOG_API_HOST: `${stubUrl}/posthog`,
    UPTIME_MONITORED_ENDPOINTS: `${stubUrl}/__health`,
    // Scenarios that need compat set it explicitly and restore it.
    WORKSPACE_AUTH_MODE: "enforce",
  };
};
