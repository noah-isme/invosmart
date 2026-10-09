// Safety checks for the integration harness itself: which database the worker
// talks to, and the guard that refuses anything but the injected loopback URL.
import { describe, expect, inject, it } from "vitest";

import { db } from "@/lib/db";

import {
  assertIntegrationDatabaseUrl,
  assertLoopbackStubUrl,
  buildIntegrationEnv,
  integrationDatabaseUrl,
  integrationDbPort,
} from "./harness/env";

describe("integration harness: database target", () => {
  it("targets the injected pglite URL, whatever the ambient DATABASE_URL was", async () => {
    const injected = inject("integrationDatabaseUrl");
    const ambient = (globalThis as { __integrationAmbientDatabaseUrl?: string | null }).__integrationAmbientDatabaseUrl;
    const port = new URL(injected).port;
    console.log(`[integration] ambient DATABASE_URL=${ambient ?? "<unset>"} -> effective ${process.env.DATABASE_URL}`);

    expect(process.env.DATABASE_URL).toBe(injected);
    expect(process.env.DIRECT_URL).toBe(injected);
    expect(new URL(injected).hostname).toBe("127.0.0.1");
    expect(Number(port)).toBe(integrationDbPort());
    expect(Number(port)).toBe(inject("integrationDbPort"));

    // The connection that @/lib/db actually uses is the one the harness built
    // with the explicit datasource URL.
    expect((globalThis as { __db?: unknown }).__db).toBe(db);

    // PGlite is Postgres compiled to WebAssembly; a real server on
    // localhost:5432 (or any ambient host) would not report emscripten.
    const [{ version }] = await db.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    console.log(`[integration] connected server: ${version}`);
    expect(version).toMatch(/PGlite/);
  });
});

describe("integration harness: pglite error recovery", () => {
  // Without the ReadyForQuery filter in test/e2e/support/db/pglite-server.mjs,
  // the queries after a SQL error fail with "Server has closed the connection".
  it("keeps working after repeated unique violations", async () => {
    const email = `int+dup-${Date.now()}@invosmart.test`;
    await db.user.create({ data: { email } });
    for (let i = 0; i < 3; i += 1) {
      await expect(db.user.create({ data: { email } })).rejects.toMatchObject({ code: "P2002" });
      expect(await db.user.count({ where: { email } })).toBe(1);
      const [{ one }] = await db.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
      expect(one).toBe(1);
    }
  });
});

describe("integration harness: setup guard", () => {
  const env = { E2E_DB_PORT: "54329" };
  const good = integrationDatabaseUrl(54339);

  it("accepts the loopback URL on E2E_DB_PORT+10 with connection_limit=1", () => {
    expect(assertIntegrationDatabaseUrl(good, 54339, env)).toBe(good);
    expect(integrationDbPort(env)).toBe(54339);
    expect(integrationDbPort({ E2E_DB_PORT: "60000" })).toBe(60010);
  });

  it.each([
    ["non-loopback host", "postgresql://user@db.example.com:54339/x?connection_limit=1"],
    ["private network host", "postgresql://postgres:postgres@10.0.0.5:54339/postgres?connection_limit=1"],
    ["default Postgres port", "postgresql://postgres:postgres@localhost:5432/postgres?connection_limit=1"],
    ["the app suite's port", "postgresql://postgres:postgres@127.0.0.1:54329/postgres?connection_limit=1"],
    ["missing connection_limit", "postgresql://postgres:postgres@127.0.0.1:54339/postgres"],
    ["pooled connection", "postgresql://postgres:postgres@127.0.0.1:54339/postgres?connection_limit=5"],
    ["empty", ""],
    ["not a URL", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(() => assertIntegrationDatabaseUrl(url, 54339, env)).toThrow(/guard/);
  });

  it("rejects an injected port that is not E2E_DB_PORT+10", () => {
    const other = integrationDatabaseUrl(54349);
    expect(() => assertIntegrationDatabaseUrl(other, 54349, env)).toThrow(/E2E_DB_PORT\+10/);
    expect(() => assertIntegrationDatabaseUrl(good, 54349, env)).toThrow(/guard/);
  });

  it("only accepts a loopback http stub URL", () => {
    expect(assertLoopbackStubUrl("http://127.0.0.1:4011")).toBe("http://127.0.0.1:4011");
    expect(() => assertLoopbackStubUrl("https://api.resend.com")).toThrow(/loopback/);
    expect(() => assertLoopbackStubUrl("")).toThrow(/empty/);
  });

  it("builds an explicit worker env that overrides every ambient database and provider URL", () => {
    const built = buildIntegrationEnv(good, "http://127.0.0.1:4011");
    expect(built.DATABASE_URL).toBe(good);
    expect(built.DIRECT_URL).toBe(good);
    expect(built.RESEND_BASE_URL).toBe("http://127.0.0.1:4011/resend");
    expect(built.INVOSMART_E2E_PROVIDER_BASE_URL).toBe("http://127.0.0.1:4011");
    expect(built.GEMINI_API_KEY).toBe("");
    expect(built.UPSTASH_REDIS_REST_URL).toBe("");
    expect(built).not.toHaveProperty("NODE_ENV");
  });
});
