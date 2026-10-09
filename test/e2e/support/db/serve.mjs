// In-memory pglite-server (pglite-server.mjs) + schema + readiness HTTP endpoint.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applySchemaAsync } from "./schema.mjs";
import { assertE2eDatabaseUrl } from "./guard.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const check = process.argv.includes("--check");
const basePort = Number(process.env.E2E_DB_PORT ?? 54329);
const dbPort = check ? basePort + 20 : basePort;
const httpPort = basePort + 1;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?connection_limit=1&pool_timeout=30`;

// Optional copy of this process's log (pglite lines, `applying schema`,
// `ready`) in arrival order, for asserting connection counts after a run.
const logFile = process.env.E2E_DB_LOG_FILE ? resolve(repoRoot, process.env.E2E_DB_LOG_FILE) : null;
if (logFile) {
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, "");
}
function logLine(stream, line) {
  stream.write(`${line}\n`);
  if (logFile) appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
}

// pglite-server.mjs: the stock PGLiteSocketServer plus the ReadyForQuery
// filter for electric-sql/pglite#958 (see the comment block in that file).
const child = spawn(
  process.execPath,
  [
    resolve(repoRoot, "test/e2e/support/db/pglite-server.mjs"),
    ...["-h", "127.0.0.1", "-p", String(dbPort), "-m", "1", "-d", "memory://"],
  ],
  { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME } },
);

/**
 * Platform-admin persona (see seed-platform-admin.mjs for the why). Runs as a
 * short-lived child with an explicit env, after the schema and BEFORE `ready`:
 * the child exits (and so has disconnected) before /ready answers 200, so the
 * app is still the only client connected after `ready`. Skipped when
 * E2E_PLATFORM_ADMIN_ID is not set (e.g. a bare `npm run e2e:db`).
 */
async function seedPlatformAdmin() {
  const id = process.env.E2E_PLATFORM_ADMIN_ID;
  if (!id) {
    logLine(process.stdout, "platformAdmin seed skipped (E2E_PLATFORM_ADMIN_ID unset)");
    return;
  }
  assertE2eDatabaseUrl(databaseUrl, dbPort, "DATABASE_URL");
  logLine(process.stdout, "seeding platformAdmin");
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    E2E_DB_PORT: String(dbPort),
    E2E_PLATFORM_ADMIN_ID: id,
    E2E_PLATFORM_ADMIN_EMAIL: process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "",
    E2E_PLATFORM_ADMIN_PASSWORD: process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? "",
    E2E_PLATFORM_ADMIN_NAME: process.env.E2E_PLATFORM_ADMIN_NAME ?? "",
  };
  const result = await new Promise((resolveRun) => {
    const seed = spawn(process.execPath, [resolve(repoRoot, "test/e2e/support/db/seed-platform-admin.mjs")], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    seed.stdout.setEncoding("utf8").on("data", (chunk) => (out += chunk));
    seed.stderr.setEncoding("utf8").on("data", (chunk) => (out += chunk));
    seed.on("error", (error) => resolveRun({ code: null, out: `${out}${error.message}` }));
    seed.on("close", (code) => resolveRun({ code, out }));
  });
  for (const line of result.out.split("\n").filter(Boolean)) logLine(process.stdout, `[seed] ${line}`);
  if (result.code !== 0) throw new Error(`platformAdmin seed failed (exit ${result.code})`);
}

let ready = false;
let httpServer = null;
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer?.close();
  if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 200).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
child.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`pglite-server exited unexpectedly (${code})`);
    shutdown(1);
  }
});

const listening = new Promise((resolveListening, reject) => {
  let buf = "";
  const onData = (chunk) => {
    const text = chunk.toString();
    for (const line of text.split("\n").filter(Boolean)) logLine(process.stderr, `[pglite] ${line}`);
    buf += text;
    if (buf.includes("PGLiteSocketServer listening")) resolveListening();
    if (buf.length > 4096) buf = buf.slice(-1024);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", reject);
  setTimeout(() => reject(new Error("pglite-server did not report listening within 60s")), 60_000).unref();
});

try {
  await listening;
  // Async so pglite lines emitted during the schema push are relayed as they
  // happen, before `ready` (a sync push would buffer them until afterwards).
  logLine(process.stdout, "applying schema");
  await applySchemaAsync({ databaseUrl, port: dbPort });
  if (!check) await seedPlatformAdmin();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (child.exitCode === null) child.kill("SIGTERM");
  process.exit(1);
}

if (check) {
  console.log("schema check ok");
  shutdown(0);
} else {
  ready = true;
  httpServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200).end("ok");
    } else if (req.url === "/ready") {
      res.writeHead(ready ? 200 : 503).end(ready ? "ready" : "not ready");
    } else {
      res.writeHead(404).end();
    }
  });
  httpServer.listen(httpPort, "127.0.0.1", () => {
    logLine(process.stdout, "ready");
  });
}
