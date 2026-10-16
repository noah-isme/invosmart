#!/usr/bin/env node
// Environment documentation gate (AGENTS.md, "Saat mengubah X, perbarui Y").
//
// Scans application code for `process.env.NAME` and `process.env["NAME"]`
// reads and fails when a name is missing from `.env.example`, the canonical
// environment reference. Test-only code (test/, __tests__/, *.test.*,
// *.spec.*, the Playwright config and the e2e scripts) is excluded: e2e
// variables are documented in docs/E2E_TESTING.md instead.
//
//   node scripts/env-docs-check.mjs [--verbose]
//
// Exit codes: 0 every variable is documented; 1 undocumented variables or a
// missing .env.example; 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ENV_EXAMPLE = ".env.example";
export const SCAN_DIRS = [
  "app",
  "components",
  "context",
  "emails",
  "hooks",
  "lib",
  "middleware",
  "prisma",
  "server",
  "scripts",
];
export const SCAN_ROOT_FILES = [
  "instrumentation.ts",
  "middleware.ts",
  "next.config.ts",
  "prisma.config.ts",
  "sentry.client.config.ts",
  "sentry.server.config.ts",
];

// Provided by Node, Next.js, Vercel or GitHub Actions; never set by hand.
export const PLATFORM_VARS = new Set([
  "CI",
  "HOME",
  "NEXT_PHASE",
  "NEXT_RUNTIME",
  "NODE_ENV",
  "PATH",
  "PORT",
  "TMPDIR",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
]);
const PLATFORM_PREFIXES = ["GITHUB_", "RUNNER_", "npm_"];

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next"]);
// Test-only helpers under scripts/: the e2e harness and the local seed probe.
// This script is excluded too: its comments mention `process.env.NAME`.
const TEST_ONLY_SCRIPTS = [
  /^scripts\/e2e-/,
  /^scripts\/check_seed_and_test_login\.ts$/,
  /^scripts\/env-docs-check\.mjs$/,
];
const ENV_READ = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\])/g;
const ENV_LINE = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/;

/** Recursively lists source files under `dir` (relative to `root`, POSIX separators). */
export function walk(root, dir) {
  const out = [];
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs).sort()) {
    const rel = `${dir}/${name}`;
    const full = join(root, rel);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      out.push(...walk(root, rel));
    } else if (SOURCE_EXT.test(name)) {
      out.push(rel.split(sep).join("/"));
    }
  }
  return out;
}

export function isExcluded(rel) {
  return TEST_FILE.test(rel) || TEST_ONLY_SCRIPTS.some((re) => re.test(rel));
}

export function isPlatformVar(name) {
  return PLATFORM_VARS.has(name) || PLATFORM_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Names documented in an env file. Commented-out assignments (`# NAME=`) count,
 * so optional variables can be documented without being set.
 */
export function parseEnvExample(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

/** Map of variable name -> first `path:line` that reads it. */
export function collectEnvReads(root) {
  const files = [
    ...SCAN_DIRS.flatMap((dir) => walk(root, dir)),
    ...SCAN_ROOT_FILES.filter((file) => existsSync(join(root, file))),
  ].filter((rel) => !isExcluded(rel));
  const reads = new Map();
  for (const rel of files) {
    const lines = readFileSync(join(root, rel), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(ENV_READ)) {
        const name = match[1] ?? match[2];
        if (!reads.has(name)) reads.set(name, `${rel}:${index + 1}`);
      }
    });
  }
  return reads;
}

export function findUndocumented(root) {
  const documented = parseEnvExample(readFileSync(join(root, ENV_EXAMPLE), "utf8"));
  const reads = collectEnvReads(root);
  const missing = [...reads.entries()]
    .filter(([name]) => !documented.has(name) && !isPlatformVar(name))
    .sort(([a], [b]) => a.localeCompare(b));
  return { documented, reads, missing };
}

function main(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--verbose");
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(" ")}`);
    console.error("Usage: node scripts/env-docs-check.mjs [--verbose]");
    return 2;
  }
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (!existsSync(join(root, ENV_EXAMPLE))) {
    console.error(`${ENV_EXAMPLE} not found`);
    return 1;
  }
  const { documented, reads, missing } = findUndocumented(root);
  if (args.includes("--verbose")) {
    for (const [name, at] of [...reads.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const state = documented.has(name) ? "documented" : isPlatformVar(name) ? "platform" : "MISSING";
      console.log(`${state.padEnd(10)} ${name}  (${at})`);
    }
  }
  if (missing.length > 0) {
    console.error(`${missing.length} environment variable(s) read by app code are missing from ${ENV_EXAMPLE}:`);
    for (const [name, at] of missing) console.error(`  ${name}  (${at})`);
    console.error(`Document each one in ${ENV_EXAMPLE} (a commented "# NAME=" line is enough for optional values).`);
    return 1;
  }
  console.log(`env-docs-check: ${reads.size} variable(s) read by app code, all documented or platform-provided.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
