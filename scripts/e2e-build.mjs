#!/usr/bin/env node
// Builds the app for the Playwright suite with fixed NEXT_PUBLIC_* values and
// writes .next/e2e-build.json so playwright.config.ts can detect a stale build.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appPort = process.env.E2E_APP_PORT ?? "3000";

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
};

export function fingerprint(values = E2E_PUBLIC_ENV) {
  const sorted = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function main() {
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const commit = git.status === 0 ? git.stdout.trim() : "unknown";

  const env = {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
    ...E2E_PUBLIC_ENV,
  };
  const build = spawnSync("npx", ["--no-install", "next", "build"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const stampPath = resolve(root, ".next/e2e-build.json");
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(
    stampPath,
    JSON.stringify({ fingerprint: fingerprint(), commit, builtAt: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(`e2e build stamp written: ${stampPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
