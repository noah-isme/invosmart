// Vitest integration layer for the [INT] e2e scenarios (test/integration/db).
//
// Unlike vitest.config.mts this config uses the real @prisma/client, next-auth
// and bcrypt (no mock aliases). globalSetup starts its own in-memory
// pglite-server on E2E_DB_PORT+10 plus the provider stub and hands their URLs
// to the tests with provide/inject; nothing is read from the repo .env. Files
// run one after another in a single fork, so this process is the only
// database client (pglite-server runs with -m 1).
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["test/integration/db/**/*.test.ts"],
    globalSetup: ["./test/integration/db/harness/global-setup.ts"],
    setupFiles: ["./test/integration/db/harness/setup.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    sequence: {
      concurrent: false,
    },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
