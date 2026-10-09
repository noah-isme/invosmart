// Schema switch point: `push` (default) or `migrate`. Child env is built explicitly.
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertE2eDatabaseUrl } from "./guard.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function buildSchemaEnv(databaseUrl) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
  };
}

export function schemaArgs(mode) {
  if (mode === "push") return ["--no-install", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"];
  if (mode === "migrate") return ["--no-install", "prisma", "migrate", "deploy"];
  throw new Error(`e2e schema: unknown E2E_SCHEMA_MODE "${mode}" (expected push or migrate)`);
}

function prepareSchemaCommand({ mode, databaseUrl, port }) {
  const env = buildSchemaEnv(databaseUrl);
  assertE2eDatabaseUrl(env.DATABASE_URL, port, "DATABASE_URL");
  assertE2eDatabaseUrl(env.DIRECT_URL, port, "DIRECT_URL");
  return { args: schemaArgs(mode), options: { cwd: repoRoot, env, encoding: "utf8" } };
}

function schemaOutput(mode, res) {
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (res.error || res.status !== 0) {
    throw new Error(
      `e2e schema (${mode}) failed${res.status != null ? ` with exit ${res.status}` : ""}:\n${out}${res.error ? `\n${res.error.message}` : ""}`,
    );
  }
  return out;
}

export function applySchema({
  mode = process.env.E2E_SCHEMA_MODE ?? "push",
  databaseUrl,
  port = process.env.E2E_DB_PORT ?? "54329",
  run = spawnSync,
} = {}) {
  const { args, options } = prepareSchemaCommand({ mode, databaseUrl, port });
  return schemaOutput(mode, run("npx", args, options));
}

/** spawnSync-shaped result from an async spawn. */
function spawnCollect(cmd, args, options) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolveRun({ status: null, stdout, stderr, error }));
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

/**
 * Same as applySchema, without blocking the event loop: serve.mjs keeps
 * relaying pglite-server's log while the schema is applied, so the log order
 * (schema connections, then `ready`, then the app) is the real order.
 */
export async function applySchemaAsync({
  mode = process.env.E2E_SCHEMA_MODE ?? "push",
  databaseUrl,
  port = process.env.E2E_DB_PORT ?? "54329",
  run = spawnCollect,
} = {}) {
  const { args, options } = prepareSchemaCommand({ mode, databaseUrl, port });
  return schemaOutput(mode, await run("npx", args, options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = applySchema({ databaseUrl: process.env.DATABASE_URL });
    process.stdout.write(out);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
