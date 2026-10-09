// Runs in the test worker before each integration file is imported.
// 1. Guards the injected database URL (loopback, E2E_DB_PORT+10, single connection).
// 2. Replaces the worker env with an explicit one, so an ambient DATABASE_URL
//    (shell, CI placeholder) or a repo .env can never be the target.
// 3. Pre-creates the Prisma client that @/lib/db picks up from globalThis.__db,
//    with the datasource URL passed explicitly, before any @/lib/db import.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, inject } from "vitest";

import { assertIntegrationDatabaseUrl, assertLoopbackStubUrl, buildIntegrationEnv } from "./env";

const databaseUrl = assertIntegrationDatabaseUrl(inject("integrationDatabaseUrl"), inject("integrationDbPort"));
const stubUrl = assertLoopbackStubUrl(inject("integrationStubUrl"));

const globals = globalThis as typeof globalThis & {
  __db?: PrismaClient;
  __integrationAmbientDatabaseUrl?: string | null;
};

if (globals.__integrationAmbientDatabaseUrl === undefined) {
  globals.__integrationAmbientDatabaseUrl = process.env.DATABASE_URL ?? null;
}

Object.assign(process.env, buildIntegrationEnv(databaseUrl, stubUrl));

// One client for the whole fork (files run one after another): a stray
// fire-and-forget write from a previous file reuses this client instead of
// opening a second connection, which pglite-server -m 1 would refuse.
// Errors no longer drop the connection: pglite-server.mjs filters PGlite's
// duplicate ReadyForQuery after an ErrorResponse (electric-sql/pglite#958).
const createClient = () => new PrismaClient({ datasources: { db: { url: databaseUrl } } });

if (!globals.__db) {
  globals.__db = createClient();
}
const client = globals.__db;

beforeAll(async () => {
  // The server is ready before tests start; retry only covers a slow first accept.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await client.$connect();
      await client.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  throw lastError;
});

afterAll(async () => {
  await client.$disconnect();
});
