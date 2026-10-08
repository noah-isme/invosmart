import test from "node:test";
import assert from "node:assert/strict";
import { assertE2eDatabaseUrl, assertE2eDatabaseUrls } from "./guard.mjs";

const ok = "postgresql://postgres:postgres@127.0.0.1:54329/postgres?connection_limit=1";

test("accepts loopback hosts on the expected port", () => {
  assert.doesNotThrow(() => assertE2eDatabaseUrl(ok, 54329));
  assert.doesNotThrow(() => assertE2eDatabaseUrl("postgresql://u@localhost:54329/x", "54329"));
  assert.doesNotThrow(() => assertE2eDatabaseUrl("postgresql://u@[::1]:54329/x", 54329));
});

test("rejects a remote host", () => {
  assert.throws(() => assertE2eDatabaseUrl("postgresql://u@db.example.com:54329/x", 54329), /not loopback/);
});

test("rejects a wrong or missing port", () => {
  assert.throws(() => assertE2eDatabaseUrl("postgresql://u@127.0.0.1:5432/x", 54329), /does not match E2E_DB_PORT/);
  assert.throws(() => assertE2eDatabaseUrl("postgresql://u@127.0.0.1/x", 54329), /does not match E2E_DB_PORT/);
});

test("rejects an ambient URL (the repo default style)", () => {
  assert.throws(() => assertE2eDatabaseUrl("postgresql://placeholder:placeholder@localhost:5432/placeholder", 54329));
  assert.throws(() => assertE2eDatabaseUrl(undefined, 54329), /empty/);
  assert.throws(() => assertE2eDatabaseUrl("not a url", 54329), /not a valid URL/);
});

test("rejects a mismatched DIRECT_URL", () => {
  assert.throws(
    () => assertE2eDatabaseUrls({ DATABASE_URL: ok, DIRECT_URL: "postgresql://u@db.example.com:54329/x" }, 54329),
    /DIRECT_URL/,
  );
  assert.doesNotThrow(() => assertE2eDatabaseUrls({ DATABASE_URL: ok, DIRECT_URL: ok }, 54329));
});
