// AUTO-INT-01: /api/cron/autonomy needs the cron bearer (401 without it).
// AUTO-INT-02: a fresh AutonomyLoopState row is created paused and the cron skips.
// AUTO-INT-03: once resumed, the first call runs one tick and persists nextRunAt
// and the scaler state, an immediate second call answers not_due, and
// ?force=1 runs again (fed the stored state). runLoop is mocked: this layer
// checks the scheduler's persistence, not the agents.
// @covers: /api/cron/autonomy (route handler called in-process; scripts/e2e-coverage-check.mjs)
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runLoopMock } = vi.hoisted(() => ({ runLoopMock: vi.fn() }));

vi.mock("@/lib/ai/loop", () => ({
  isAutonomyEnabled: () => true,
  runLoop: runLoopMock,
}));

import { GET as autonomyCron } from "@/app/api/cron/autonomy/route";
import { E2E_SECRETS } from "../../e2e/playwright.env";

import { db, request } from "./harness/fixtures";

const MIN = 60_000;

const call = (query = "", auth = true) =>
  autonomyCron(
    request(`/api/cron/autonomy${query}`, {
      headers: auth ? { authorization: `Bearer ${E2E_SECRETS.CRON_SECRET}` } : {},
    }),
  );

const telemetry = {
  timestamp: "2026-10-17T09:00:00.000Z",
  load: 0.1,
  backlogSize: 2,
  trustScore: 82,
  successRate: 0.8,
  errorRate: 0.01,
  avgLatencyMs: 250,
  regressionDetected: false,
  recoveryAction: "noop",
  rollbackCount: 0,
};

beforeEach(async () => {
  runLoopMock.mockReset().mockResolvedValue({
    enabled: true,
    intervalMs: 2 * MIN,
    concurrency: 2,
    priorities: [],
    scaling: { state: { concurrency: 2, intervalMs: 2 * MIN }, status: "steady", reason: "", backlogSize: 2, avgLatencyMs: 250 },
    recovery: {
      agent: "optimizer",
      action: "noop",
      reason: "",
      trustScoreBefore: 82,
      trustScoreAfter: 82,
      createdAt: new Date(),
    },
    telemetry,
    summary: "STEADY | Recovery: NOOP",
    history: [],
  });
  await db.autonomyLoopState.deleteMany({});
});

describe("/api/cron/autonomy", () => {
  it("AUTO-INT-01 answers 401 without the cron bearer", async () => {
    const res = await call("", false);
    expect(res.status).toBe(401);
    expect(runLoopMock).not.toHaveBeenCalled();
  });

  it("AUTO-INT-02 creates the state row paused and skips", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "paused" });
    const row = await db.autonomyLoopState.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.paused).toBe(true);
    expect(runLoopMock).not.toHaveBeenCalled();
  });

  it("AUTO-INT-03 runs once resumed, persists nextRunAt, then answers not_due until forced", async () => {
    await db.autonomyLoopState.create({ data: { id: "singleton", paused: false } });

    const before = Date.now();
    const first = await call();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ran: true, intervalMs: 2 * MIN, concurrency: 2 });

    const row = await db.autonomyLoopState.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.nextRunAt!.getTime()).toBeGreaterThanOrEqual(before + 5 * MIN);
    expect(row.lastRunAt).not.toBeNull();
    expect(row.lastIntervalMs).toBe(2 * MIN);
    expect(row.lastConcurrency).toBe(2);
    expect(row.lastTelemetry).toEqual(telemetry);
    expect(row.lastSummary).toBe("STEADY | Recovery: NOOP");
    expect(row.claimedUntil).toBeNull();

    const second = await call();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ skipped: "not_due", nextRunAt: row.nextRunAt!.toISOString() });
    expect(runLoopMock).toHaveBeenCalledTimes(1);

    const forced = await call("?force=1");
    expect(forced.status).toBe(200);
    expect(await forced.json()).toMatchObject({ ran: true });
    expect(runLoopMock).toHaveBeenCalledTimes(2);
    expect(runLoopMock).toHaveBeenLastCalledWith({
      scaling: { concurrency: 2, intervalMs: 2 * MIN },
      previousTelemetry: telemetry,
    });
  });
});
