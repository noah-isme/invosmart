import { NextRequest, NextResponse } from "next/server";

import { AuditAction, AuditEntity, logAuditEvent } from "@/lib/audit/auditLogger";
import { requireCronAuthorization } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { RetentionConfigError, readRetentionConfig, runRetentionPurge } from "@/lib/retention/purge";

/**
 * Daily data-retention purge (vercel.json, 03:00 UTC). See lib/retention/purge.ts
 * for what is deleted and SECURITY.md "Retention and deletion" for the policy.
 *
 * Safeguards, in order:
 *   - CRON_SECRET bearer (requireCronAuthorization);
 *   - first-run gate: unless RETENTION_ENABLED=true, a non-dry run returns
 *     skipped:"disabled" without any write (dry runs work regardless, so an
 *     operator can review the counts first);
 *   - config validation: invalid periods return 500 and purge nothing;
 *   - CronLease "retention": an overlapping invocation returns skipped:"locked";
 *     a crashed run holds the lease for at most LEASE_MS;
 *   - batch caps from the config, and one RETENTION_PURGE audit row per real run.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const LEASE_NAME = "retention";
const LEASE_MS = 10 * 60 * 1000;

async function handle(request: NextRequest) {
  const authError = requireCronAuthorization(request);
  if (authError) return authError;

  const dryRun =
    new URL(request.url).searchParams.get("dryRun") === "1" || process.env.RETENTION_DRY_RUN === "true";

  if (!dryRun && process.env.RETENTION_ENABLED !== "true") {
    return NextResponse.json({ skipped: "disabled" });
  }

  let config;
  try {
    config = readRetentionConfig();
  } catch (error) {
    if (error instanceof RetentionConfigError) {
      console.error("[cron/retention] invalid configuration", { message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }

  const now = new Date();
  await db.cronLease.upsert({ where: { name: LEASE_NAME }, create: { name: LEASE_NAME }, update: {} });
  const claimed = await db.cronLease.updateMany({
    where: { name: LEASE_NAME, OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }] },
    data: { claimedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ skipped: "locked" });
  }

  let result;
  try {
    result = await runRetentionPurge({ now, dryRun, config, db });
  } catch (error) {
    console.error("[cron/retention] purge failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Retention purge failed" }, { status: 500 });
  } finally {
    try {
      await db.cronLease.update({
        where: { name: LEASE_NAME },
        // A dry run releases the lease but is not recorded as a run.
        data: dryRun ? { claimedUntil: null } : { claimedUntil: null, lastRunAt: new Date() },
      });
    } catch (error) {
      console.error("[cron/retention] lease release failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.info("[cron/retention]", JSON.stringify(result));

  // Dry runs change nothing, including the audit trail.
  if (!dryRun) {
    await logAuditEvent({
      action: AuditAction.RETENTION_PURGE,
      entity: AuditEntity.RETENTION,
      userId: null,
      tenantId: null,
      details: result,
    });
  }

  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
