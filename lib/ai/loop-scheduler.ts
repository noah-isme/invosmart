import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { isAutonomyEnabled, runLoop, type LoopTelemetry } from "./loop";

/**
 * Cron-driven scheduler for the autonomy loop (ADR 016).
 *
 * The /api/cron/autonomy cron fires every CRON_PERIOD_MS; each invocation calls
 * runScheduledTick(), which runs one runLoop() tick only when the persisted
 * AutonomyLoopState row says one is due. Everything runLoop used to keep in
 * process memory between ticks (interval, concurrency, last telemetry) is read
 * from and written back to that row, because serverless instances do not
 * survive between cron invocations.
 *
 * The row is created paused: deploying this cannot start recovery sweeps or
 * automatic rollbacks by itself. A platform admin resumes the loop from
 * DevTools (/api/devtools/autonomy), which flips `paused`.
 */

export const AUTONOMY_LOOP_STATE_ID = "singleton";

/** Matches the vercel.json schedule of /api/cron/autonomy; also the minimum interval. */
export const CRON_PERIOD_MS = 5 * 60_000;

/**
 * A tick may run up to this long before nextRunAt. Without it, a cron that
 * fires a second before nextRunAt would skip and the effective interval would
 * double to two cron periods.
 */
export const DUE_TOLERANCE_MS = 30_000;

/** How long a claimed tick holds the row; a crashed tick blocks the next one at most this long. */
export const LEASE_MS = 4 * 60_000;

export type ScheduledTickResult =
  | { skipped: "disabled" }
  | { skipped: "paused" }
  | { skipped: "not_due"; nextRunAt: string }
  | { skipped: "locked" }
  | {
      ran: true;
      lastRunAt: string;
      nextRunAt: string;
      intervalMs: number;
      concurrency: number;
      summary: string;
    };

const ensureRow = () =>
  db.autonomyLoopState.upsert({
    where: { id: AUTONOMY_LOOP_STATE_ID },
    create: { id: AUTONOMY_LOOP_STATE_ID, paused: true },
    update: {},
  });

export async function runScheduledTick({
  now,
  force = false,
}: {
  now: Date;
  force?: boolean;
}): Promise<ScheduledTickResult> {
  if (!isAutonomyEnabled()) return { skipped: "disabled" };

  const row = await ensureRow();
  if (row.paused) return { skipped: "paused" };

  const due =
    force || row.nextRunAt == null || row.nextRunAt.getTime() - DUE_TOLERANCE_MS <= now.getTime();
  if (!due) return { skipped: "not_due", nextRunAt: row.nextRunAt!.toISOString() };

  const claimed = await db.autonomyLoopState.updateMany({
    where: { id: row.id, OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }] },
    data: { claimedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) return { skipped: "locked" };

  let released = false;
  try {
    const result = await runLoop({
      scaling: {
        concurrency: row.lastConcurrency ?? undefined,
        intervalMs: row.lastIntervalMs ?? undefined,
      },
      previousTelemetry: (row.lastTelemetry as LoopTelemetry | null) ?? undefined,
    });

    const nextRunAt = new Date(now.getTime() + Math.max(result.intervalMs, CRON_PERIOD_MS));
    // JSON-safe subset (RecoveryResult.createdAt is a Date).
    const lastResult = JSON.parse(
      JSON.stringify({ scaling: result.scaling, recovery: result.recovery }),
    ) as Prisma.InputJsonValue;

    await db.autonomyLoopState.update({
      where: { id: row.id },
      data: {
        lastRunAt: now,
        nextRunAt,
        lastIntervalMs: result.intervalMs,
        lastConcurrency: result.concurrency,
        lastTelemetry: result.telemetry,
        lastSummary: result.summary,
        lastResult,
        claimedUntil: null,
      },
    });
    released = true;

    return {
      ran: true,
      lastRunAt: now.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
      intervalMs: result.intervalMs,
      concurrency: result.concurrency,
      summary: result.summary,
    };
  } finally {
    if (!released) {
      try {
        await db.autonomyLoopState.update({ where: { id: row.id }, data: { claimedUntil: null } });
      } catch (error) {
        console.error("[autonomy] lease release failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/** Persists the DevTools pause/resume switch so it applies to the production cron. */
export async function setAutonomyPaused(paused: boolean) {
  return db.autonomyLoopState.upsert({
    where: { id: AUTONOMY_LOOP_STATE_ID },
    create: { id: AUTONOMY_LOOP_STATE_ID, paused },
    update: { paused },
  });
}
