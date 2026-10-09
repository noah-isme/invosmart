#!/usr/bin/env node
// pglite-server replacement for the e2e and integration DB: the stock
// PGLiteSocketServer (unmodified) in front of a PGlite whose
// execProtocolRawStream is wrapped by a ReadyForQuery filter.
//
// Why: PGlite 0.5.8 / @electric-sql/pglite-socket 0.2.11 (upstream
// electric-sql/pglite#958) answers an extended-protocol message that fails
// (Parse/Bind/Describe/Execute raising an ErrorResponse) with `E` followed by
// a premature ReadyForQuery `Z`, and then sends the regular `Z` for the
// client's Sync. Real Postgres sends exactly one `Z` per Sync. The Prisma
// engine treats the duplicate `Z` as a protocol violation and closes the
// connection, so the next 1-4 queries fail with "Server has closed the
// connection" until its pool reconnects (and each reconnect is a new client
// on a single-connection server).
//
// Filter rule: PGLiteSocketServer hands PGlite one client message at a time.
// For a single message whose type is not startup (0x00), Query (Q), Sync (S)
// or Flush (F), the complete reply is buffered; if it contains an
// ErrorResponse (E) and ends with a complete 6-byte ReadyForQuery (Z), that
// trailing Z is dropped. Everything else passes through byte for byte.
// Q and S legitimately end with Z (also after an error), so they are never
// touched.
//
// Forward-compat guard: if the socket server ever hands over a batch instead
// of one message (isSingleMessage() false), the reply is not framed as we
// expect, or the reply has no E or does not end with Z, the filter degrades
// to passthrough. A fixed upstream (no premature Z) therefore runs through
// this file unchanged.
//
// Shared-session caveat: PGlite is a single Postgres backend. Every socket
// client shares it, including named prepared statements and transaction
// state, which is why `-m 2` (two Prisma clients) fails: their named
// prepared statements live in the same backend and collide.
// Keep `-m 1` and `connection_limit=1`.
//
// CLI (subset of the upstream pglite-server): -d/--db (default memory://),
// -p/--port (5432), -h/--host (127.0.0.1), -m/--max-connections (1).
// Log lines match the upstream CLI so serve.mjs readiness and the
// `Client connected` assertions keep working.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const Z_LEN = 6;
// startup/SSL/cancel (first byte 0 of the length), Query, Sync, Flush
const PASSTHROUGH = new Set([0x00, 0x51, 0x53, 0x46]);

/** True when `m` is exactly one startup-style or one typed protocol message. */
export function isSingleMessage(m) {
  if (m.length >= 8 && m[0] === 0) return true;
  return m.length >= 5 && 1 + Buffer.from(m.buffer, m.byteOffset, m.length).readInt32BE(1) === m.length;
}

/**
 * Drops a trailing ReadyForQuery from a fully framed backend reply that also
 * contains an ErrorResponse. Any framing surprise returns the reply unchanged.
 */
export function stripTrailingReadyForQuery(reply) {
  let o = 0;
  let last = -1;
  let sawError = false;
  while (o + 5 <= reply.length) {
    const len = reply.readInt32BE(o + 1);
    if (len < 4 || o + 1 + len > reply.length) return reply;
    if (reply[o] === 0x45) sawError = true;
    last = o;
    o += 1 + len;
  }
  const endsWithZ = last !== -1 && o === reply.length && reply[last] === 0x5a && reply.length - last === Z_LEN;
  return sawError && endsWithZ ? reply.subarray(0, last) : reply;
}

/** Wraps db.execProtocolRawStream (public API) with the filter above. */
export function installReadyForQueryFilter(db) {
  const orig = db.execProtocolRawStream.bind(db);
  db.execProtocolRawStream = async (message, options = {}) => {
    if (PASSTHROUGH.has(message[0]) || !isSingleMessage(message) || !options.onRawData) {
      return orig(message, options);
    }
    const chunks = [];
    await orig(message, { ...options, onRawData: (d) => chunks.push(Buffer.from(d)) });
    const out = stripTrailingReadyForQuery(Buffer.concat(chunks));
    if (out.length) options.onRawData(new Uint8Array(out));
  };
  return db;
}

async function main() {
  const { values } = parseArgs({
    options: {
      db: { type: "string", short: "d", default: "memory://" },
      port: { type: "string", short: "p", default: "5432" },
      host: { type: "string", short: "h", default: "127.0.0.1" },
      "max-connections": { type: "string", short: "m", default: "1" },
    },
  });
  const dbPath = values.db;
  const port = Number.parseInt(values.port, 10);
  const host = values.host;
  const maxConnections = Number.parseInt(values["max-connections"], 10);

  console.log(`Initializing PGLite with database: ${dbPath}`);
  console.log("Debug level: 0");
  const db = new PGlite(dbPath);
  await db.waitReady;
  installReadyForQueryFilter(db);
  console.log("PGlite database initialized");

  const server = new PGLiteSocketServer({ db, host, port, maxConnections });
  server.addEventListener("listening", (event) => {
    console.log(`PGLiteSocketServer listening on ${JSON.stringify(event.detail)}`);
  });
  server.addEventListener("connection", (event) => {
    const { clientAddress, clientPort } = event.detail;
    console.log(`Client connected from ${clientAddress}:${clientPort}`);
  });
  server.addEventListener("error", (event) => {
    console.error("Socket server error:", event.detail);
  });

  let stopping = false;
  const shutdown = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    console.log("\nShutting down PGLiteSocketServer...");
    try {
      await server.stop();
      await db.close();
    } finally {
      console.log("Server stopped");
      process.exit(code);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await server.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("Failed to start PGLiteSocketServer:", error);
    process.exit(1);
  });
}
