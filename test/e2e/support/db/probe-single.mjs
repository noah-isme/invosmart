// One Prisma client, connection_limit=1, 45 concurrent jobs. Must print "single: failed 0".
import { TABLE, buildJobs, makeClient, runJobs } from "./probe-lib.mjs";

const client = makeClient();
let exitCode = 0;
try {
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${TABLE} (id serial PRIMARY KEY, tag text, n int)`);
  const { total, failed, firstError } = await runJobs(buildJobs(client, "single"));
  console.log(`single: failed ${failed}`);
  if (failed) {
    console.error(`single: ${failed}/${total} jobs failed; first error: ${firstError?.message ?? firstError}`);
    exitCode = 1;
  }
} catch (error) {
  console.log("single: failed all");
  console.error(error?.message ?? error);
  exitCode = 1;
} finally {
  try {
    await client.$executeRawUnsafe(`DROP TABLE IF EXISTS ${TABLE}`);
  } catch {}
  await client.$disconnect().catch(() => {});
}
process.exit(exitCode);
