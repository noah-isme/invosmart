// Starts the integration layer's own pglite-server (via serve.mjs, schema
// applied before readiness) and the provider stub, then injects their URLs.
// Only child processes started here are stopped in teardown.
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { GlobalSetupContext } from "vitest/node";

import { createStub } from "../../../e2e/support/provider-stub/server.mjs";
import {
  assertIntegrationDatabaseUrl,
  assertLoopbackStubUrl,
  integrationDatabaseUrl,
  integrationDbPort,
} from "./env";

declare module "vitest" {
  export interface ProvidedContext {
    integrationDatabaseUrl: string;
    integrationDbPort: number;
    integrationStubUrl: string;
  }
}

const repoRoot = resolve(__dirname, "../../../..");
const READY_TIMEOUT_MS = 60_000;

const waitForReady = async (readyUrl: string, child: ChildProcess, log: () => string) => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`serve.mjs exited with ${child.exitCode} before ready:\n${log()}`);
    }
    try {
      const res = await fetch(readyUrl);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`pglite-server was not ready at ${readyUrl} within ${READY_TIMEOUT_MS} ms:\n${log()}`);
};

const stopChild = (child: ChildProcess) =>
  new Promise<void>((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
    const timer = setTimeout(() => {
      // serve.mjs forwards SIGTERM to pglite-server; SIGKILL only if it hangs.
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill("SIGTERM");
  });

export default async function setup({ provide }: GlobalSetupContext) {
  const dbPort = integrationDbPort();
  const databaseUrl = integrationDatabaseUrl(dbPort);
  assertIntegrationDatabaseUrl(databaseUrl, dbPort);

  const stub = createStub({ port: 0 });
  const { url: stubUrl } = await stub.listen();
  assertLoopbackStubUrl(stubUrl);

  // serve.mjs binds the DB to E2E_DB_PORT and readiness to E2E_DB_PORT+1, so
  // the integration ports are selected by handing it the shifted base. The
  // env is built explicitly: no ambient DATABASE_URL or .env reaches it.
  let output = "";
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    E2E_DB_PORT: String(dbPort),
    E2E_SCHEMA_MODE: process.env.E2E_SCHEMA_MODE ?? "push",
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  };
  const child: ChildProcess = spawn(process.execPath, [resolve(repoRoot, "test/e2e/support/db/serve.mjs")], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv as unknown as NodeJS.ProcessEnv,
  });
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 20_000) output = output.slice(-10_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  try {
    await waitForReady(`http://127.0.0.1:${dbPort + 1}/ready`, child, () => output);
  } catch (error) {
    await stopChild(child);
    await stub.close();
    throw error;
  }

  console.log(`[integration] pglite-server ready at ${databaseUrl.replace(/:postgres@/, ":***@")} (pid ${child.pid})`);
  console.log(`[integration] provider stub at ${stubUrl}`);

  provide("integrationDatabaseUrl", databaseUrl);
  provide("integrationDbPort", dbPort);
  provide("integrationStubUrl", stubUrl);

  return async () => {
    await stopChild(child);
    await stub.close();
  };
}
