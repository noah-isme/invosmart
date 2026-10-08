#!/usr/bin/env node
// Builds the app for the Playwright suite with fixed NEXT_PUBLIC_* values and
// writes .next/e2e-build.json so playwright.config.ts can detect a stale build.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_PUBLIC_ENV, fingerprint } from "./e2e-public-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export { E2E_PUBLIC_ENV, fingerprint } from "./e2e-public-env.mjs";

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

  // BUILD_ID ties the stamp to this exact build: a later plain `next build`
  // replaces BUILD_ID, so playwright.config.ts rejects the stale stamp.
  const buildId = readFileSync(resolve(root, ".next/BUILD_ID"), "utf8").trim();
  const stampPath = resolve(root, ".next/e2e-build.json");
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(
    stampPath,
    JSON.stringify({ fingerprint: fingerprint(), buildId, commit, builtAt: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(`e2e build stamp written: ${stampPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
