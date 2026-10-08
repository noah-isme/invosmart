// In-memory pglite-server + schema + readiness HTTP endpoint.
import { spawn } from "node:child_process";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema } from "./schema.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const check = process.argv.includes("--check");
const basePort = Number(process.env.E2E_DB_PORT ?? 54329);
const dbPort = check ? basePort + 20 : basePort;
const httpPort = basePort + 1;
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?connection_limit=1&pool_timeout=30`;

const child = spawn(
  resolve(repoRoot, "node_modules/.bin/pglite-server"),
  ["-h", "127.0.0.1", "-p", String(dbPort), "-m", "1", "-d", "memory://"],
  { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME } },
);

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
    process.stderr.write(text.split("\n").filter(Boolean).map((l) => `[pglite] ${l}\n`).join(""));
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
  applySchema({ databaseUrl, port: dbPort });
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
    console.log("ready");
  });
}
