// Unit tests for the ReadyForQuery filter in pglite-server.mjs, plus a
// socket-level test against the real server with a hand-rolled wire client.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installReadyForQueryFilter, isSingleMessage, stripTrailingReadyForQuery } from "./pglite-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// ---------- protocol serialisers (frontend and backend shapes) ----------

const cstr = (s) => Buffer.from(`${s}\0`, "utf8");
function msg(type, body = Buffer.alloc(0)) {
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(4 + body.length, 1);
  return Buffer.concat([head, body]);
}
function startup(params = { user: "postgres", database: "postgres" }) {
  const body = Buffer.concat([
    ...Object.entries(params).flatMap(([k, v]) => [cstr(k), cstr(v)]),
    Buffer.from([0]),
  ]);
  const head = Buffer.alloc(8);
  head.writeInt32BE(8 + body.length, 0);
  head.writeInt32BE(196608, 4);
  return Buffer.concat([head, body]);
}
const int16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
};
const int32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
};
const Query = (sql) => msg("Q", cstr(sql));
const Parse = (sql, name = "") => msg("P", Buffer.concat([cstr(name), cstr(sql), int16(0)]));
const Bind = (portal = "", stmt = "") =>
  msg("B", Buffer.concat([cstr(portal), cstr(stmt), int16(0), int16(0), int16(0)]));
const Execute = (portal = "") => msg("E", Buffer.concat([cstr(portal), int32(0)]));
const Sync = () => msg("S");
const Flush = () => msg("H");

// Backend-shaped messages for the pure filter tests.
const ReadyForQuery = (status = "I") => msg("Z", Buffer.from(status, "latin1"));
const ErrorResponse = () => msg("E", Buffer.concat([Buffer.from("S"), cstr("ERROR"), Buffer.from([0])]));
const DataRow = () => msg("D", Buffer.concat([int16(1), int32(1), Buffer.from("1")]));
const ParseComplete = () => msg("1");

// ---------- pure filter ----------

test("stripTrailingReadyForQuery: E Z -> E", () => {
  const e = ErrorResponse();
  assert.deepEqual(stripTrailingReadyForQuery(Buffer.concat([e, ReadyForQuery()])), e);
});

test("stripTrailingReadyForQuery: D D E Z -> D D E", () => {
  const head = Buffer.concat([DataRow(), DataRow(), ErrorResponse()]);
  assert.deepEqual(stripTrailingReadyForQuery(Buffer.concat([head, ReadyForQuery("E")])), head);
});

test("stripTrailingReadyForQuery: replies without an error are unchanged", () => {
  const one = ParseComplete();
  assert.equal(stripTrailingReadyForQuery(one), one);
  const z = ReadyForQuery();
  assert.equal(stripTrailingReadyForQuery(z), z);
  const dz = Buffer.concat([DataRow(), ReadyForQuery()]);
  assert.equal(stripTrailingReadyForQuery(dz), dz);
});

test("stripTrailingReadyForQuery: incomplete or odd framing is unchanged", () => {
  const e = ErrorResponse();
  const truncatedZ = Buffer.concat([e, ReadyForQuery().subarray(0, 5)]);
  assert.equal(stripTrailingReadyForQuery(truncatedZ), truncatedZ);
  const overlongZ = Buffer.concat([e, msg("Z", Buffer.from("II"))]);
  assert.equal(stripTrailingReadyForQuery(overlongZ), overlongZ);
  const errorNotLast = Buffer.concat([e, ReadyForQuery(), ParseComplete()]);
  assert.equal(stripTrailingReadyForQuery(errorNotLast), errorNotLast);
  const badLength = Buffer.concat([e, Buffer.from([0x5a, 0, 0, 0, 0, 0x49])]);
  assert.equal(stripTrailingReadyForQuery(badLength), badLength);
  assert.equal(stripTrailingReadyForQuery(Buffer.alloc(0)).length, 0);
});

test("isSingleMessage", () => {
  assert.equal(isSingleMessage(new Uint8Array(startup())), true);
  assert.equal(isSingleMessage(new Uint8Array(Execute())), true);
  assert.equal(isSingleMessage(new Uint8Array(Buffer.concat([Bind(), Execute()]))), false);
  assert.equal(isSingleMessage(new Uint8Array(Execute().subarray(0, 6))), false);
  // A view into a larger buffer is read at its own offset.
  const big = Buffer.concat([Buffer.alloc(3), Sync()]);
  assert.equal(isSingleMessage(new Uint8Array(big.buffer, big.byteOffset + 3, 5)), true);
});

// ---------- filter wrapper over a fake db ----------

function fakeDb(reply) {
  const calls = [];
  return {
    calls,
    async execProtocolRawStream(message, options) {
      calls.push({ message, options });
      // Stream the reply in two chunks, as PGlite may.
      const mid = Math.floor(reply.length / 2);
      if (mid) options.onRawData(new Uint8Array(reply.subarray(0, mid)));
      options.onRawData(new Uint8Array(reply.subarray(mid)));
    },
  };
}
async function run(db, message) {
  const out = [];
  await db.execProtocolRawStream(new Uint8Array(message), { onRawData: (d) => out.push(Buffer.from(d)) });
  return Buffer.concat(out);
}

test("filter drops the premature Z after an error on a single extended message", async () => {
  const db = installReadyForQueryFilter(fakeDb(Buffer.concat([ErrorResponse(), ReadyForQuery()])));
  assert.deepEqual(await run(db, Execute()), ErrorResponse());
});

test("filter passes Q, S, F, startup and multi-message input through untouched", async () => {
  const reply = Buffer.concat([ErrorResponse(), ReadyForQuery()]);
  for (const input of [
    Query("select x"),
    Sync(),
    msg("F", Buffer.alloc(4)),
    startup(),
    Buffer.concat([Bind(), Execute()]),
  ]) {
    const db = installReadyForQueryFilter(fakeDb(reply));
    assert.deepEqual(await run(db, input), reply, `input type 0x${input[0].toString(16)}`);
  }
});

test("filter passes non-error replies through untouched", async () => {
  const reply = Buffer.concat([ParseComplete(), msg("2")]);
  const db = installReadyForQueryFilter(fakeDb(reply));
  assert.deepEqual(await run(db, Parse("select 1")), reply);
});

test("filter forwards syncToFs and calls through when there is no onRawData", async () => {
  const db = installReadyForQueryFilter(fakeDb(ReadyForQuery()));
  await db.execProtocolRawStream(new Uint8Array(Execute()), { syncToFs: false, onRawData: () => {} });
  assert.equal(db.calls.at(-1).options.syncToFs, false);
  const plain = installReadyForQueryFilter({
    calls: 0,
    async execProtocolRawStream() {
      this.calls += 1;
    },
  });
  await plain.execProtocolRawStream(new Uint8Array(Execute()), {});
  assert.equal(plain.calls, 1);
});

// ---------- real server over a socket ----------

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [resolve(here, "pglite-server.mjs"), "-h", "127.0.0.1", "-p", String(port), "-m", "1", "-d", "memory://"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`server not listening within 60s:\n${log}`)), 60_000);
    const onData = (chunk) => {
      log += chunk.toString();
      if (log.includes("PGLiteSocketServer listening")) {
        clearTimeout(timer);
        res();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => rej(new Error(`server exited (${code}):\n${log}`)));
  });
  return {
    port,
    log: () => log,
    stop: () =>
      new Promise((res) => {
        if (child.exitCode !== null) return res();
        child.once("exit", () => res());
        child.kill("SIGTERM");
      }),
  };
}

// Minimal wire client: reads typed backend messages, waits for N ReadyForQuery.
function connect(port) {
  const sock = net.connect(port, "127.0.0.1");
  let buf = Buffer.alloc(0);
  let messages = [];
  let waiter = null;
  const check = () => {
    if (waiter && messages.filter((m) => m.type === "Z").length >= waiter.n) {
      const w = waiter;
      waiter = null;
      clearTimeout(w.timer);
      // Give a stray duplicate Z a moment to arrive before resolving.
      setTimeout(() => {
        const got = messages;
        messages = [];
        w.res(got);
      }, 150);
    }
  };
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 5) {
      const len = buf.readInt32BE(1);
      if (buf.length < 1 + len) break;
      const type = String.fromCharCode(buf[0]);
      messages.push({ type, body: buf.subarray(5, 1 + len) });
      buf = buf.subarray(1 + len);
    }
    check();
  });
  const ready = new Promise((res, rej) => {
    sock.once("connect", res);
    sock.once("error", rej);
  });
  return {
    ready,
    send(...parts) {
      sock.write(Buffer.concat(parts));
    },
    until(n) {
      return new Promise((res, rej) => {
        waiter = {
          n,
          res,
          timer: setTimeout(() => rej(new Error(`timeout; got ${describe(messages)}`)), 10_000),
        };
        check();
      });
    },
    close() {
      sock.end();
      sock.destroy();
    },
  };
}
const describe = (ms) => ms.map((m) => (m.type === "Z" ? `Z(${m.body.toString("latin1")})` : m.type)).join(" ");

test("socket: one ReadyForQuery per Sync after extended-protocol errors", { timeout: 120_000 }, async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const c = connect(server.port);
  t.after(() => c.close());
  await c.ready;

  c.send(startup());
  const hello = await c.until(1);
  assert.equal(describe(hello).endsWith("Z(I)"), true, describe(hello));

  c.send(Query("CREATE TABLE u (email text PRIMARY KEY); INSERT INTO u VALUES ('a')"));
  await c.until(1);

  const dup = "INSERT INTO u VALUES ('a')";

  // Parse + Bind + Execute (erroring) + Sync in one write.
  c.send(Parse(dup), Bind(), Execute(), Sync());
  const failed = await c.until(1);
  t.diagnostic(`P B E S (unique violation): ${describe(failed)}`);
  assert.equal(describe(failed), "1 2 E Z(I)");

  // Named statement parsed first; then Bind + Execute (erroring) + Sync.
  c.send(Parse(dup, "dup"), Sync());
  assert.equal(describe(await c.until(1)), "1 Z(I)");
  c.send(Bind("", "dup"), Execute(), Sync());
  const bes = await c.until(1);
  t.diagnostic(`B E S on a named statement: ${describe(bes)}`);
  assert.equal(describe(bes), "2 E Z(I)");

  c.send(Query("select 1"));
  const sel = await c.until(1);
  t.diagnostic(`Q select 1: ${describe(sel)}`);
  assert.equal(describe(sel), "T D C Z(I)");

  // Inside a transaction: the error aborts it, one Z(E), ROLLBACK -> Z(I).
  c.send(Query("BEGIN"));
  assert.equal(describe(await c.until(1)), "C Z(T)");
  c.send(Parse(dup), Bind(), Execute(), Sync());
  const inTx = await c.until(1);
  t.diagnostic(`in BEGIN, P B E S: ${describe(inTx)}`);
  assert.equal(describe(inTx), "1 2 E Z(E)");
  c.send(Query("ROLLBACK"));
  const rb = await c.until(1);
  t.diagnostic(`ROLLBACK: ${describe(rb)}`);
  assert.equal(describe(rb), "C Z(I)");

  // Two pipelined batches: the failing one, then a good one.
  c.send(Parse(dup), Bind(), Execute(), Sync(), Parse("select 1"), Bind(), Execute(), Sync());
  const piped = await c.until(2);
  t.diagnostic(`pipelined fail + ok: ${describe(piped)}`);
  assert.equal(describe(piped), "1 2 E Z(I) 1 2 D C Z(I)");
  c.send(Bind("", "dup"), Execute(), Sync(), Parse("INSERT INTO u VALUES ('b')"), Bind(), Execute(), Sync());
  const piped2 = await c.until(2);
  t.diagnostic(`pipelined B E S + insert: ${describe(piped2)}`);
  assert.equal(describe(piped2), "2 E Z(I) 1 2 C Z(I)");

  // Flush after an error does not produce a Z either.
  c.send(Parse(dup), Bind(), Execute(), Flush(), Sync());
  const flushed = await c.until(1);
  t.diagnostic(`P B E H S: ${describe(flushed)}`);
  assert.equal(describe(flushed), "1 2 E Z(I)");

  const connections = server.log().match(/Client connected from/g) ?? [];
  assert.equal(connections.length, 1, server.log());
});
