#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_MIGRATION = "20260812173000_payment_attempts_events";
export const REQUIRED_API_MIGRATION = "20260814110000_api_keys";

export const REQUIRED_GATE_SCRIPTS = ["lint", "typecheck", "test", "build", "test:e2e"];

export const REQUIRED_REPOSITORY_FILES = [
  "package.json",
  "package-lock.json",
  "prisma/schema.prisma",
  "playwright.config.ts",
  "test/e2e/invoice-delivery-payment.spec.ts",
  "docs/API.md",
  "app/api/openapi.json/route.ts",
  "app/api/v1/invoices/route.ts",
  "app/api/v1/clients/route.ts",
  "app/api/workspaces/[id]/api-keys/route.ts",
  "app/app/settings/api/page.tsx",
  "lib/api-keys.ts",
  "lib/api-v1/auth.ts",
];

export const REQUIRED_STAGING_ENV = [
  "DATABASE_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "MIDTRANS_SERVER_KEY",
  "MIDTRANS_CLIENT_KEY",
  "NEXT_PUBLIC_MIDTRANS_CLIENT_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET",
];

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const boolFromEnv = (value) => /^(1|true|yes)$/i.test(String(value ?? "").trim());

/**
 * Parse the release certification CLI without pulling in a dotenv or CLI
 * dependency. Staging secrets must be injected by the caller, never read from
 * a committed file or printed to the log.
 */
export function parseArgs(argv = [], env = process.env) {
  const options = {
    mode: env.RELEASE_CERTIFICATION_MODE?.trim() || "ci",
    checkMigrations: boolFromEnv(env.RELEASE_CERTIFICATION_CHECK_MIGRATIONS),
    runGates: boolFromEnv(env.RELEASE_CERTIFICATION_RUN_GATES),
    reportPath: env.RELEASE_CERTIFICATION_REPORT?.trim() || "",
    allowHttp: boolFromEnv(env.RELEASE_CERTIFICATION_ALLOW_HTTP),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--mode") {
      options.mode = next ?? "";
      index += 1;
      continue;
    }

    if (argument.startsWith("--mode=")) {
      options.mode = argument.slice("--mode=".length);
      continue;
    }

    if (argument === "--check-migrations") {
      options.checkMigrations = true;
      continue;
    }

    if (argument === "--run-gates") {
      options.runGates = true;
      continue;
    }

    if (argument === "--allow-http") {
      options.allowHttp = true;
      continue;
    }

    if (argument === "--report") {
      options.reportPath = next ?? "";
      index += 1;
      continue;
    }

    if (argument.startsWith("--report=")) {
      options.reportPath = argument.slice("--report=".length);
      continue;
    }

    throw new Error(`Unknown release certification option: ${argument}`);
  }

  options.mode = options.mode.toLowerCase();
  if (options.mode !== "ci" && options.mode !== "staging") {
    throw new Error(`Release certification mode must be ci or staging, received: ${options.mode}`);
  }

  return options;
}

export function checkNodeVersion(version = process.versions.node) {
  const major = String(version).replace(/^v/, "").split(".")[0];
  return {
    name: "Node.js 20",
    ok: major === "20",
    detail: `Detected Node.js ${version}; certification requires major version 20.`,
  };
}

const isPlaceholder = (value) => {
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized.includes("replace_with") ||
    normalized.includes("yourdomain.com") ||
    normalized.includes("example.com") ||
    normalized.includes("<your-") ||
    normalized.includes("...")
  );
};

const redacted = (value) =>
  String(value)
    .replace(/(postgres(?:ql)?:\/\/)[^\s'"`]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[^\s'"`]+/gi, "$1[redacted]");

export function validateStagingEnvironment(env = process.env, { allowHttp = false } = {}) {
  const missing = [];
  const placeholders = [];

  for (const name of REQUIRED_STAGING_ENV) {
    const value = env[name]?.trim();
    if (!value) {
      missing.push(name);
    } else if (isPlaceholder(value)) {
      placeholders.push(name);
    }
  }

  const errors = [];
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl && !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    errors.push("DATABASE_URL must use a PostgreSQL connection string");
  }

  const nextAuthUrl = env.NEXTAUTH_URL?.trim();
  if (nextAuthUrl) {
    try {
      const parsed = new URL(nextAuthUrl);
      if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
        errors.push("NEXTAUTH_URL must use https (use --allow-http only for a local rehearsal)");
      }
    } catch {
      errors.push("NEXTAUTH_URL must be an absolute URL");
    }
  }

  if (env.RESEND_FROM_EMAIL?.trim() && !/^\S+@\S+\.\S+$/.test(env.RESEND_FROM_EMAIL.trim())) {
    errors.push("RESEND_FROM_EMAIL must be a valid email address");
  }

  return {
    name: "Staging environment configuration",
    ok: missing.length === 0 && placeholders.length === 0 && errors.length === 0,
    detail: "Required application, PostgreSQL, Midtrans, Stripe, and Resend settings are present without placeholder values.",
    missing,
    placeholders,
    errors,
    present: REQUIRED_STAGING_ENV.filter((name) => Boolean(env[name]?.trim())),
  };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function inspectRepository(cwd = process.cwd()) {
  const failures = [];
  let packageJson;
  const packagePath = resolve(cwd, "package.json");

  if (!existsSync(packagePath)) {
    failures.push("package.json is missing");
  } else {
    try {
      packageJson = readJson(packagePath);
    } catch (error) {
      failures.push(`package.json is not valid JSON: ${error.message}`);
    }
  }

  if (packageJson) {
    if (packageJson.engines?.node !== "20.x") {
      failures.push('package.json engines.node must be "20.x"');
    }

    for (const script of REQUIRED_GATE_SCRIPTS) {
      if (typeof packageJson.scripts?.[script] !== "string") {
        failures.push(`package.json is missing the ${script} script`);
      }
    }
  }

  for (const relativePath of REQUIRED_REPOSITORY_FILES) {
    if (!existsSync(resolve(cwd, relativePath))) {
      failures.push(`required certification file is missing: ${relativePath}`);
    }
  }

  for (const [label, migration] of [
    ["payment", REQUIRED_MIGRATION],
    ["API key", REQUIRED_API_MIGRATION],
  ]) {
    const migrationDirectory = resolve(cwd, "prisma/migrations", migration);
    if (!existsSync(resolve(migrationDirectory, "migration.sql"))) {
      failures.push(`required ${label} migration is missing: prisma/migrations/${migration}/migration.sql`);
    }
  }

  let migrationCount = 0;
  const migrationsRoot = resolve(cwd, "prisma/migrations");
  if (existsSync(migrationsRoot)) {
    migrationCount = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  }

  return {
    name: "Repository certification configuration",
    ok: failures.length === 0,
    detail: `${migrationCount} Prisma migration directories and all critical gate entrypoints were found.`,
    failures,
    migrationCount,
  };
}

export function runMigrationStatus({ cwd = process.cwd(), env = process.env } = {}) {
  const result = spawnSync(
    npxCommand,
    ["--no-install", "prisma", "migrate", "status", "--schema=prisma/schema.prisma"],
    {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const output = redacted(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).trim();
  const hasPendingMigrations = /not yet been applied|schema is not up to date|pending migration/i.test(output);
  const ok = result.status === 0 && !hasPendingMigrations;

  return {
    name: "Prisma migration state",
    ok,
    detail: ok
      ? "The connected PostgreSQL database reports no pending or failed migrations."
      : "The connected PostgreSQL database could not be certified as current.",
    exitCode: result.status,
    output: output.slice(-4000),
  };
}

const runGate = ({ label, command, args, cwd, env }) => {
  console.log(`\n[release-certification] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  return {
    name: label,
    ok: result.status === 0,
    detail: result.status === 0 ? "passed" : `failed with exit code ${result.status ?? "unknown"}`,
    exitCode: result.status,
  };
};

export function runCriticalGates({ cwd = process.cwd(), env = process.env } = {}) {
  const gateEnv = {
    ...env,
    ENABLE_TELEMETRY: "false",
    NEXT_PUBLIC_ENABLE_TELEMETRY: "false",
  };

  const commands = [
    {
      label: "Prisma schema validation",
      command: npxCommand,
      args: ["--no-install", "prisma", "validate", "--schema=prisma/schema.prisma"],
    },
    { label: "Lint", command: npmCommand, args: ["run", "lint"] },
    { label: "Typecheck", command: npmCommand, args: ["run", "typecheck"] },
    { label: "Unit tests", command: npmCommand, args: ["run", "test", "--", "--reporter=dot"] },
    { label: "Production build", command: npmCommand, args: ["run", "build"] },
    {
      label: "Critical Chromium browser contract",
      command: npmCommand,
      args: ["run", "test:e2e", "--", "test/e2e/invoice-delivery-payment.spec.ts"],
    },
  ];

  return commands.map((command) => runGate({ ...command, cwd, env: gateEnv }));
}

const printCheck = (check) => {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  if (!check.ok) {
    for (const value of check.missing ?? []) console.log(`  missing: ${value}`);
    for (const value of check.placeholders ?? []) console.log(`  placeholder: ${value}`);
    for (const value of check.errors ?? []) console.log(`  error: ${value}`);
    for (const value of check.failures ?? []) console.log(`  error: ${value}`);
    if (check.output) console.log(`  command output:\n${check.output}`);
  }
};

export function writeReport(path, report) {
  const reportPath = resolve(process.cwd(), path);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

export function runCertification({ options, cwd = process.cwd(), env = process.env, nodeVersion = process.versions.node } = {}) {
  const nodeCheck = checkNodeVersion(nodeVersion);
  const checks = [nodeCheck, inspectRepository(cwd)];
  let stagingEnvironmentIsValid = true;

  if (options.mode === "staging") {
    const environmentCheck = validateStagingEnvironment(env, { allowHttp: options.allowHttp });
    checks.push(environmentCheck);
    stagingEnvironmentIsValid = environmentCheck.ok;
  } else {
    checks.push({
      name: "Staging environment configuration",
      ok: true,
      detail: "Skipped in CI mode; provider and database secrets are required only for an explicit staging certification run.",
      skipped: true,
    });
  }

  if ((options.checkMigrations || options.mode === "staging") && stagingEnvironmentIsValid) {
    checks.push(runMigrationStatus({ cwd, env }));
  } else if (options.mode === "staging") {
    checks.push({
      name: "Prisma migration state",
      ok: true,
      detail: "Skipped because staging environment configuration failed; no database connection was attempted.",
      skipped: true,
    });
  } else {
    checks.push({
      name: "Prisma migration state",
      ok: true,
      detail: "Skipped in CI mode because no database secret is required for ordinary builds or pull requests.",
      skipped: true,
    });
  }

  if (options.runGates && stagingEnvironmentIsValid && nodeCheck.ok) {
    checks.push(...runCriticalGates({ cwd, env }));
  } else if (options.runGates && options.mode === "staging") {
    checks.push({
      name: "Critical application gates",
      ok: true,
      detail: `Skipped because ${!nodeCheck.ok ? "Node.js 20 is required" : "staging environment configuration failed"}; no certification gate was attempted.`,
      skipped: true,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    nodeVersion,
    checks,
    ok: checks.every((check) => check.ok),
  };
}

function printUsage() {
  console.log(`Usage: node scripts/release-certification.mjs [options]

Options:
  --mode ci|staging       Select secret-free CI or staging certification (default: ci)
  --check-migrations      Run prisma migrate status against DATABASE_URL
  --run-gates             Run Prisma validate, lint, typecheck, tests, build, and critical E2E
  --report <path>         Write a redacted JSON evidence report
  --allow-http            Allow http NEXTAUTH_URL for a local rehearsal only
`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`release-certification: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  const report = runCertification({ options });
  for (const check of report.checks) printCheck(check);

  if (options.reportPath) {
    const reportPath = writeReport(options.reportPath, report);
    console.log(`Evidence report written to ${reportPath}`);
  }

  if (!report.ok) {
    console.error("\nRelease certification failed. Resolve the failed checks before promoting the release.");
    process.exitCode = 1;
  } else {
    console.log("\nRelease certification checks passed.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
