// Shared helpers for the PGlite probes. Reads DATABASE_URL / E2E_DB_PORT from env only.
import { PrismaClient } from "@prisma/client";

export function probeUrl() {
  const port = process.env.E2E_DB_PORT ?? "54329";
  const base = process.env.DATABASE_URL ?? `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  const url = new URL(base);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "30");
  return url.toString();
}

export function makeClient() {
  return new PrismaClient({ datasources: { db: { url: probeUrl() } }, log: [] });
}

export const TABLE = "e2e_probe_items";

// 5 interactive transactions (await inside), 30 reads, 10 writes.
export function buildJobs(client, tag) {
  const jobs = [];
  for (let i = 0; i < 5; i++) {
    jobs.push(() =>
      client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${TABLE} (tag, n) VALUES ($1, $2)`, `${tag}-tx`, i);
        const rows = await tx.$queryRawUnsafe(`SELECT count(*)::int AS c FROM ${TABLE}`);
        if (!rows.length) throw new Error("empty read in transaction");
      }),
    );
  }
  for (let i = 0; i < 30; i++) jobs.push(() => client.$queryRawUnsafe(`SELECT count(*)::int AS c FROM ${TABLE}`));
  for (let i = 0; i < 10; i++)
    jobs.push(() => client.$executeRawUnsafe(`INSERT INTO ${TABLE} (tag, n) VALUES ($1, $2)`, `${tag}-w`, i));
  return jobs;
}

export async function runJobs(jobs) {
  const results = await Promise.allSettled(jobs.map((job) => job()));
  const failures = results.filter((r) => r.status === "rejected");
  return { total: results.length, failed: failures.length, firstError: failures[0]?.reason };
}
