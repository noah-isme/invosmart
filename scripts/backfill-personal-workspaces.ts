/**
 * Provision a personal workspace (Organization + OWNER Membership +
 * activeOrganizationId) for every user that has no membership.
 *
 *   DATABASE_URL=postgresql://... npm run db:backfill-workspaces            # dry run (default)
 *   DATABASE_URL=postgresql://... npm run db:backfill-workspaces -- --apply # write
 *
 * Safe to re-run: users that already have any membership are never selected,
 * and the provisioning step re-checks under a row lock. DATABASE_URL must be
 * exported in the environment (a value only present in .env is not accepted)
 * so the target is always an explicit choice.
 */
import { PrismaClient } from "@prisma/client";

import {
  backfillPersonalWorkspaces,
  describeDatabaseTarget,
  type BackfillClient,
} from "../lib/workspace-backfill";

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
        "Export it explicitly, e.g. DATABASE_URL=postgresql://... npm run db:backfill-workspaces",
    );
    process.exit(2);
  }

  console.log(`Target database: ${target}`);
  console.log(apply ? "Mode: APPLY (writing)" : "Mode: dry run (no writes; pass --apply to write)");

  const db = new PrismaClient();
  try {
    const result = await backfillPersonalWorkspaces(db as unknown as BackfillClient, { apply });

    console.log(`Users without any membership: ${result.candidateIds.length}`);
    for (const id of result.candidateIds) {
      console.log(`  ${id}`);
    }

    if (apply) {
      console.log(`Provisioned: ${result.provisionedIds.length}`);
      if (result.failed.length > 0) {
        console.error(`Failed: ${result.failed.length}`);
        for (const failure of result.failed) {
          console.error(`  ${failure.id}: ${failure.error}`);
        }
        process.exitCode = 1;
      }
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
