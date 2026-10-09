// Pre-creates the platformAdmin persona's User row with a FIXED id, before the
// app starts.
//
// Why: platform admin is decided by `ADMIN_USER_IDS` (session user id, see
// lib/devtools/access.ts); ADMIN_EMAILS is ignored. The app server reads
// ADMIN_USER_IDS once at start, but a registered user's id is a cuid generated
// at run time. So serve.mjs runs this short-lived script after the schema is
// applied and BEFORE it reports `ready`; playwright.env.ts sets
// ADMIN_USER_IDS=E2E_PLATFORM_ADMIN_ID for the app, and setup/personas.setup.ts
// only logs the persona in (registration answers 409 for it).
//
// Writes exactly one row: "User" { id, email, name, password } with a bcrypt
// hash made the same way as lib/hash.ts (bcrypt, 10 rounds). Credentials
// sign-in (server/auth.ts authorize) needs nothing else. The workspace is
// created through the app API by personas.setup.ts.
//
// Test-only: refuses any DATABASE_URL that is not this run's loopback pglite
// (guard.mjs), reads only the explicit env serve.mjs hands it, and fully
// disconnects before exiting so the app stays the only client after `ready`.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

import { assertE2eDatabaseUrl } from "./guard.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`seed-platform-admin: ${name} is required`);
  return value;
};

async function main() {
  const databaseUrl = required("DATABASE_URL");
  assertE2eDatabaseUrl(databaseUrl, required("E2E_DB_PORT"), "DATABASE_URL");
  const id = required("E2E_PLATFORM_ADMIN_ID");
  const email = required("E2E_PLATFORM_ADMIN_EMAIL");
  const password = required("E2E_PLATFORM_ADMIN_PASSWORD");
  const name = process.env.E2E_PLATFORM_ADMIN_NAME || null;

  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  try {
    const hashed = await bcrypt.hash(password, 10);
    // upsert: a rerun against the same in-memory database keeps one row.
    await client.user.upsert({
      where: { id },
      create: { id, email, name, password: hashed },
      update: { email, name, password: hashed },
    });
    // PGlite runs ONE backend for every socket client, so session state
    // outlives this connection: Prisma's named prepared statements (s0, s1,
    // ...) would collide with the app's own and fail its first write.
    await client.$executeRawUnsafe("DEALLOCATE ALL");
  } finally {
    await client.$disconnect();
  }
  console.log(`seeded platformAdmin user ${id}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
