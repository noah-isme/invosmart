import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { fingerprint } from "./scripts/e2e-public-env.mjs";
import {
  E2E_APP_PORT,
  E2E_APP_URL,
  E2E_DB_LOG_FILE,
  E2E_DB_PORT,
  E2E_DB_READY_URL,
  E2E_STUB_PORT,
  E2E_STUB_URL,
  e2eAppEnv,
  e2eContractAppEnv,
  personaStorageStatePath,
} from "./test/e2e/playwright.env";

const stagingBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || "";
const isStaging = stagingBaseUrl !== "";
const isContractOnly = !isStaging && process.env.E2E_CONTRACT_ONLY === "1";
const isListOnly = process.argv.includes("--list");
const isNightly = process.env.E2E_TIER === "nightly";

// Kept until Step 9 moves the spec to specs/contracts/.
const LEGACY_CONTRACT_SPEC = "**/test/e2e/invoice-delivery-payment.spec.ts";
const SPEC_FILES = "**/test/e2e/specs/**/*.spec.ts";
const CONTRACT_SPEC_FILES = "**/test/e2e/specs/contracts/**/*.spec.ts";
// Request-only files run in the `api` project (no browser).
const API_SPEC_FILES = ["**/test/e2e/specs/api-v1/**/*.spec.ts", "**/test/e2e/specs/security/**/*.api.spec.ts"];

/**
 * NEXT_PUBLIC_* values are inlined by `next build`, so the local suite must run
 * against a build produced by `npm run e2e:build`. Skipped for `--list`, for
 * staging (no local server) and for the no-DB contract gate.
 */
function assertE2eBuildStamp(): void {
  const stampPath = resolve(__dirname, ".next/e2e-build.json");
  const hint = "Run `npm run e2e:build` before the Playwright suite (needs network for next/font).";
  if (!existsSync(stampPath)) {
    throw new Error(`E2E build stamp missing: ${stampPath}. ${hint}`);
  }
  let stamp: { fingerprint?: string; buildId?: string };
  try {
    stamp = JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    throw new Error(`E2E build stamp unreadable: ${stampPath}. ${hint}`);
  }
  if (stamp.fingerprint !== fingerprint()) {
    throw new Error(`E2E build stamp is stale (NEXT_PUBLIC_* values differ): ${stampPath}. ${hint}`);
  }
  const buildIdPath = resolve(__dirname, ".next/BUILD_ID");
  const buildId = existsSync(buildIdPath) ? readFileSync(buildIdPath, "utf8").trim() : "";
  if (!stamp.buildId || stamp.buildId !== buildId) {
    throw new Error(`E2E build stamp does not match the current .next build (rebuilt without e2e values?). ${hint}`);
  }
}

if (!isListOnly && !isStaging && !isContractOnly) assertE2eBuildStamp();

const gracefulShutdown = { signal: "SIGTERM" as const, timeout: 5_000 };

const appServer = (env: Record<string, string>) => ({
  command: `npm run start -- -p ${E2E_APP_PORT}`,
  url: `${E2E_APP_URL}/api/health`,
  env,
  reuseExistingServer: false,
  timeout: 120_000,
  stdout: "ignore" as const,
  stderr: "pipe" as const,
  gracefulShutdown,
});

function webServers(): PlaywrightTestConfig["webServer"] {
  if (isStaging) return undefined;
  if (isContractOnly) return [appServer(e2eContractAppEnv())];
  return [
    {
      command: "node test/e2e/support/provider-stub/server.mjs",
      url: `${E2E_STUB_URL}/__health`,
      env: { E2E_STUB_PORT: String(E2E_STUB_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown,
    },
    {
      // pglite-server on 127.0.0.1:E2E_DB_PORT; /ready on E2E_DB_PORT+1 answers
      // 200 only after applySchema(), so the app never sees an empty database.
      command: "node test/e2e/support/db/serve.mjs",
      url: E2E_DB_READY_URL,
      env: {
        E2E_DB_PORT: String(E2E_DB_PORT),
        E2E_SCHEMA_MODE: process.env.E2E_SCHEMA_MODE ?? "push",
        E2E_DB_LOG_FILE,
      },
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown,
    },
    appServer(e2eAppEnv()),
  ];
}

function projects(): PlaywrightTestConfig["projects"] {
  const browser = { ...devices["Desktop Chrome"] };
  if (isContractOnly) {
    // No DB, no personas: only the page.route-mocked contract specs.
    return [{ name: "chromium", testMatch: [CONTRACT_SPEC_FILES, LEGACY_CONTRACT_SPEC], use: browser }];
  }
  return [
    // Registers the personas and writes test/e2e/.auth/<persona>.json.
    { name: "setup", testMatch: "**/*.setup.ts" },
    {
      name: "chromium",
      testMatch: [SPEC_FILES, LEGACY_CONTRACT_SPEC],
      testIgnore: API_SPEC_FILES,
      dependencies: ["setup"],
      // Signed in as the owner persona by default; unauthenticated specs use
      // test.use({ storageState: { cookies: [], origins: [] } }).
      use: { ...browser, storageState: personaStorageStatePath("owner") },
    },
    { name: "api", testMatch: API_SPEC_FILES },
  ];
}

export default defineConfig({
  testDir: "test/e2e",
  outputDir: "QA-report/results",
  timeout: 120_000,
  globalTimeout: (isNightly ? 22 : 15) * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  grep: isStaging ? /@staging/ : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "QA-report/html", open: "never" }],
    ["junit", { outputFile: "QA-report/junit.xml" }],
  ],
  use: {
    baseURL: isStaging ? stagingBaseUrl : E2E_APP_URL,
    reducedMotion: "reduce",
    // PWA-01 opts back in; cached dashboards would otherwise leak between tests.
    serviceWorkers: "block",
    actionTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },
  projects: projects(),
  webServer: webServers(),
});
