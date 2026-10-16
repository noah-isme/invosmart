import { beforeEach, describe, expect, it, vi } from "vitest";

const runLoopMock = vi.fn();
const isAutonomyEnabledMock = vi.fn();

const autonomyLoopState = {
  upsert: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/ai/loop", () => ({
  runLoop: runLoopMock,
  isAutonomyEnabled: isAutonomyEnabledMock,
}));

vi.mock("@/lib/db", () => ({
  db: { autonomyLoopState },
}));

const NOW = new Date("2026-10-17T09:00:00.000Z");
const MIN = 60_000;

const telemetry = {
  timestamp: "2026-10-17T08:55:00.000Z",
  load: 0.2,
  backlogSize: 3,
  trustScore: 80,
  successRate: 0.7,
  errorRate: 0.02,
  avgLatencyMs: 250,
  regressionDetected: false,
  recoveryAction: "noop" as const,
  rollbackCount: 0,
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "singleton",
  paused: false,
  nextRunAt: null as Date | null,
  lastRunAt: null,
  lastIntervalMs: 420_000,
  lastConcurrency: 3,
  lastTelemetry: telemetry,
  lastSummary: null,
  lastResult: null,
  claimedUntil: null,
  updatedAt: NOW,
  ...overrides,
});

const loopResult = (intervalMs: number) => ({
  enabled: true,
  intervalMs,
  concurrency: 2,
  priorities: [],
  scaling: { state: { concurrency: 2, intervalMs }, status: "steady", reason: "", backlogSize: 3, avgLatencyMs: 250 },
  recovery: {
    agent: "optimizer",
    action: "noop",
    reason: "",
    trustScoreBefore: 80,
    trustScoreAfter: 80,
    createdAt: new Date("2026-10-17T09:00:01.000Z"),
  },
  telemetry: { ...telemetry, timestamp: NOW.toISOString() },
  summary: "STEADY | Prioritas: ok | Recovery: NOOP",
  history: [],
});

describe("runScheduledTick", () => {
  beforeEach(() => {
    vi.resetModules();
    runLoopMock.mockReset().mockResolvedValue(loopResult(60_000));
    isAutonomyEnabledMock.mockReset().mockReturnValue(true);
    autonomyLoopState.upsert.mockReset().mockResolvedValue(row());
    autonomyLoopState.updateMany.mockReset().mockResolvedValue({ count: 1 });
    autonomyLoopState.update.mockReset().mockResolvedValue(row());
  });

  const tick = async (force = false) => {
    const { runScheduledTick } = await import("@/lib/ai/loop-scheduler");
    return runScheduledTick({ now: NOW, force });
  };

  it("creates the row paused when it is missing and skips while paused", async () => {
    autonomyLoopState.upsert.mockResolvedValue(row({ paused: true }));
    await expect(tick()).resolves.toEqual({ skipped: "paused" });
    expect(autonomyLoopState.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      create: { id: "singleton", paused: true },
      update: {},
    });
    expect(runLoopMock).not.toHaveBeenCalled();
  });

  it("skips when ENABLE_AI_AUTONOMY is off", async () => {
    isAutonomyEnabledMock.mockReturnValue(false);
    await expect(tick()).resolves.toEqual({ skipped: "disabled" });
    expect(autonomyLoopState.upsert).not.toHaveBeenCalled();
  });

  it("skips when the next run is 2 minutes ahead", async () => {
    const nextRunAt = new Date(NOW.getTime() + 2 * MIN);
    autonomyLoopState.upsert.mockResolvedValue(row({ nextRunAt }));
    await expect(tick()).resolves.toEqual({ skipped: "not_due", nextRunAt: nextRunAt.toISOString() });
    expect(autonomyLoopState.updateMany).not.toHaveBeenCalled();
    expect(runLoopMock).not.toHaveBeenCalled();
  });

  it("runs a tick that fires 1 s before nextRunAt (cron jitter tolerance)", async () => {
    autonomyLoopState.upsert.mockResolvedValue(row({ nextRunAt: new Date(NOW.getTime() + 1_000) }));
    await expect(tick()).resolves.toMatchObject({ ran: true });
    expect(runLoopMock).toHaveBeenCalledTimes(1);
  });

  it("skips a tick that fires 31 s before nextRunAt", async () => {
    autonomyLoopState.upsert.mockResolvedValue(row({ nextRunAt: new Date(NOW.getTime() + 31_000) }));
    await expect(tick()).resolves.toMatchObject({ skipped: "not_due" });
    expect(runLoopMock).not.toHaveBeenCalled();
  });

  it("force runs even when not due", async () => {
    autonomyLoopState.upsert.mockResolvedValue(row({ nextRunAt: new Date(NOW.getTime() + 10 * MIN) }));
    await expect(tick(true)).resolves.toMatchObject({ ran: true });
  });

  it("skips when another invocation holds the lease", async () => {
    autonomyLoopState.updateMany.mockResolvedValue({ count: 0 });
    await expect(tick()).resolves.toEqual({ skipped: "locked" });
    expect(autonomyLoopState.updateMany).toHaveBeenCalledWith({
      where: { id: "singleton", OR: [{ claimedUntil: null }, { claimedUntil: { lt: NOW } }] },
      data: { claimedUntil: new Date(NOW.getTime() + 4 * MIN) },
    });
    expect(runLoopMock).not.toHaveBeenCalled();
  });

  it("passes the stored scaler state into runLoop and persists the result with a 5-minute floor", async () => {
    const result = await tick();

    expect(runLoopMock).toHaveBeenCalledWith({
      scaling: { concurrency: 3, intervalMs: 420_000 },
      previousTelemetry: telemetry,
    });

    const expectedNext = new Date(NOW.getTime() + 5 * MIN);
    expect(result).toMatchObject({ ran: true, nextRunAt: expectedNext.toISOString(), intervalMs: 60_000 });

    expect(autonomyLoopState.update).toHaveBeenCalledTimes(1);
    const { data } = autonomyLoopState.update.mock.calls[0][0];
    expect(data.nextRunAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 5 * MIN);
    expect(data).toMatchObject({
      lastRunAt: NOW,
      lastIntervalMs: 60_000,
      lastConcurrency: 2,
      lastSummary: "STEADY | Prioritas: ok | Recovery: NOOP",
      claimedUntil: null,
    });
    expect(data.lastTelemetry).toEqual({ ...telemetry, timestamp: NOW.toISOString() });
    expect(data.lastResult.recovery.createdAt).toBe("2026-10-17T09:00:01.000Z");
    expect(data.lastResult.scaling.status).toBe("steady");
  });

  it("uses the loop interval when it exceeds the cron period", async () => {
    runLoopMock.mockResolvedValue(loopResult(12 * MIN));
    await expect(tick()).resolves.toMatchObject({
      nextRunAt: new Date(NOW.getTime() + 12 * MIN).toISOString(),
    });
  });

  it("omits overrides when nothing is stored yet", async () => {
    autonomyLoopState.upsert.mockResolvedValue(
      row({ lastIntervalMs: null, lastConcurrency: null, lastTelemetry: null }),
    );
    await tick();
    expect(runLoopMock).toHaveBeenCalledWith({
      scaling: { concurrency: undefined, intervalMs: undefined },
      previousTelemetry: undefined,
    });
  });

  it("clears the lease when the loop throws", async () => {
    runLoopMock.mockRejectedValue(new Error("boom"));
    await expect(tick()).rejects.toThrow("boom");
    expect(autonomyLoopState.update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: { claimedUntil: null },
    });
  });

  it("setAutonomyPaused upserts the persisted switch", async () => {
    const { setAutonomyPaused } = await import("@/lib/ai/loop-scheduler");
    await setAutonomyPaused(false);
    expect(autonomyLoopState.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      create: { id: "singleton", paused: false },
      update: { paused: false },
    });
  });
});
