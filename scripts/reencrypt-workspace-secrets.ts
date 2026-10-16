/**
 * Re-encrypt every workspace notification secret (Slack webhook URL) with the
 * active WORKSPACE_NOTIFICATION_ENCRYPTION_KEY, in the v2 format. Run after a
 * key rotation (SECURITY.md "Secrets"); the old key must still be listed in
 * WORKSPACE_NOTIFICATION_ENCRYPTION_KEYRING.
 *
 *   DATABASE_URL=postgresql://... npm run secrets:reencrypt            # dry run (default)
 *   DATABASE_URL=postgresql://... npm run secrets:reencrypt -- --apply # write
 *
 * --apply requires WORKSPACE_NOTIFICATION_ENCRYPTION_V2_WRITE=true. Writes are
 * compare-and-set, so the script is safe to re-run and never overwrites a
 * secret saved while it runs. Prints counts and failing row ids only.
 * DATABASE_URL must be exported in the environment so the target is always an
 * explicit choice.
 */
import { PrismaClient } from "@prisma/client";

import { ReencryptGuardError, reencryptEndpoints, type ReencryptClient } from "../lib/team/reencrypt-secrets";
import { describeDatabaseTarget } from "../lib/workspace-backfill";

async function main() {
  const apply = process.argv.includes("--apply");
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
  if (unknownArgs.length > 0) {
    console.error(`Unknown arguments: ${unknownArgs.join(" ")}. Only --apply is supported.`);
    process.exit(2);
  }

  const target = describeDatabaseTarget(process.env.DATABASE_URL);
  if (!target) {
    console.error(
      "Refusing to run: DATABASE_URL is not set in the environment (or is not a valid URL). " +
        "Export it explicitly, e.g. DATABASE_URL=postgresql://... npm run secrets:reencrypt",
    );
    process.exit(2);
  }

  console.log(`Target database: ${target}`);
  console.log(apply ? "Mode: APPLY (writing)" : "Mode: dry run (no writes; pass --apply to write)");

  const db = new PrismaClient();
  try {
    const result = await reencryptEndpoints({ db: db as unknown as ReencryptClient, apply });
    console.log(`scanned: ${result.scanned}`);
    console.log(`${apply ? "reencrypted" : "would reencrypt"}: ${result.reencrypted}`);
    console.log(`skipped (already v2 under the active key): ${result.skipped}`);
    console.log(`skipped_concurrent: ${result.skippedConcurrent}`);
    console.log(`failed: ${result.failed}`);
    for (const id of result.failedIds) {
      console.error(`  failed id: ${id}`);
    }
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    if (error instanceof ReencryptGuardError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
