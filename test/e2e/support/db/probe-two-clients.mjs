// Two Prisma clients (each connection_limit=1) against one PGlite server. Documents the constraint:
// at -m 1 the second connection is refused; at -m 2 it is flaky (42P05 prepared statement collisions).
// Prints "two-clients: refused" | "two-clients: flaky (n failed)" | "two-clients: ok". Always exits 0.
import { TABLE, buildJobs, makeClient, runJobs } from "./probe-lib.mjs";

const a = makeClient();
const b = makeClient();
let outcome;
try {
  await a.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${TABLE} (id serial PRIMARY KEY, tag text, n int)`);
  const [ra, rb] = await Promise.all([runJobs(buildJobs(a, "a")), runJobs(buildJobs(b, "b"))]);
  const failed = ra.failed + rb.failed;
  const err = String(ra.firstError?.message ?? rb.firstError?.message ?? "");
  if (failed && /Can't reach database server|P1001|P1017|Timed out|P2024/i.test(err)) outcome = "refused";
  else if (failed) outcome = `flaky (${failed} failed)`;
  else outcome = "ok";
} catch (error) {
  outcome = "refused";
  console.error(String(error?.message ?? error).split("\n")[0]);
} finally {
  try {
    await a.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLE}`);
  } catch {}
  await Promise.all([a.$disconnect().catch(() => {}), b.$disconnect().catch(() => {})]);
}
console.log(`two-clients: ${outcome}`);
process.exit(0);
