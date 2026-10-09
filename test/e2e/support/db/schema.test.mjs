import test from "node:test";
import assert from "node:assert/strict";
import { applySchema, applySchemaAsync, buildSchemaEnv, schemaArgs } from "./schema.mjs";

const url = "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

test("child env is explicit and ignores ambient database variables", () => {
  const prev = { ...process.env };
  process.env.DATABASE_URL = "postgresql://ambient@db.example.com/x";
  process.env.DIRECT_URL = "postgresql://ambient@db.example.com/y";
  process.env.NEXTAUTH_SECRET = "leak";
  try {
    let seen;
    applySchema({
      databaseUrl: url,
      port: 54329,
      mode: "push",
      run: (cmd, args, opts) => {
        seen = { cmd, args, opts };
        return { status: 0, stdout: "ok", stderr: "" };
      },
    });
    assert.deepEqual(Object.keys(seen.opts.env).sort(), ["DATABASE_URL", "DIRECT_URL", "HOME", "PATH"]);
    assert.equal(seen.opts.env.DATABASE_URL, url);
    assert.equal(seen.opts.env.DIRECT_URL, url);
    assert.equal(seen.cmd, "npx");
    assert.deepEqual(seen.args, ["--no-install", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"]);
  } finally {
    process.env = prev;
  }
});

test("migrate mode runs migrate deploy", () => {
  assert.deepEqual(schemaArgs("migrate"), ["--no-install", "prisma", "migrate", "deploy"]);
  assert.throws(() => schemaArgs("bogus"), /unknown E2E_SCHEMA_MODE/);
  assert.equal(buildSchemaEnv(url).DIRECT_URL, url);
});

test("guard runs before spawning and failures are surfaced", () => {
  let called = false;
  const run = () => {
    called = true;
    return { status: 1, stdout: "", stderr: "P3018 boom" };
  };
  assert.throws(
    () => applySchema({ databaseUrl: "postgresql://u@db.example.com:54329/x", port: 54329, run }),
    /not loopback/,
  );
  assert.equal(called, false);
  assert.throws(() => applySchema({ databaseUrl: url, port: 54329, run }), /P3018 boom/);
});

test("applySchemaAsync uses the same explicit env, guard and error surfacing", async () => {
  let seen;
  const out = await applySchemaAsync({
    databaseUrl: url,
    port: 54329,
    mode: "push",
    run: async (cmd, args, opts) => {
      seen = { cmd, args, opts };
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(out, "ok");
  assert.deepEqual(Object.keys(seen.opts.env).sort(), ["DATABASE_URL", "DIRECT_URL", "HOME", "PATH"]);
  assert.deepEqual(seen.args, schemaArgs("push"));
  await assert.rejects(
    applySchemaAsync({ databaseUrl: "postgresql://u@db.example.com:54329/x", port: 54329, run: async () => ({ status: 0 }) }),
    /not loopback/,
  );
  await assert.rejects(
    applySchemaAsync({ databaseUrl: url, port: 54329, run: async () => ({ status: 1, stdout: "", stderr: "P3018 boom" }) }),
    /P3018 boom/,
  );
});
