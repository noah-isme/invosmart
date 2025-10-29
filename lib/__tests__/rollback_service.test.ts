import { describe, expect, it, vi } from "vitest";
import type { OptimizationLog } from "@prisma/client";

vi.mock("@prisma/client", () => ({
  OptimizationStatus: {
    PENDING: "PENDING",
    APPLIED: "APPLIED",
    REJECTED: "REJECTED",
  },
}));

type RollbackInput = OptimizationLog[];

const updateMock = vi.fn(async ({ where: { id }, data }: { where: { id: string }; data: Partial<RollbackInput[number]> }) => ({
  id,
  route: (data.route as string) ?? "/app/dashboard",
  status: data.status ?? "APPLIED",
  rollback: data.rollback ?? false,
  notes: data.notes ?? null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    optimizationLog: {
      update: updateMock,
    },
  },
}));

const captureMessageMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureMessage: captureMessageMock,
}));

const { processAutoRollback } = await import("@/lib/ai/rollback");

describe("auto rollback service", () => {
  it("skips rollback when regression under threshold", async () => {
    updateMock.mockClear();
    captureMessageMock.mockClear();

    const logs: RollbackInput = [
      {
        id: "log-a",
        route: "/app/dashboard",
        status: "APPLIED",
        notes: "",
      } as RollbackInput[number],
    ];

    const result = await processAutoRollback(logs, -0.02, { threshold: -0.05 });

    expect(result).toHaveLength(0);
    expect(updateMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("marks logs as rejected when regression exceeds threshold", async () => {
    updateMock.mockClear();
    captureMessageMock.mockClear();

    const logs: RollbackInput = [
      {
        id: "log-b",
        route: "/app/dashboard",
        status: "APPLIED",
        notes: "",
      } as RollbackInput[number],
    ];

    const result = await processAutoRollback(logs, -0.12, { threshold: -0.05 });

    expect(result).toHaveLength(1);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "log-b" },
      data: expect.objectContaining({ rollback: true, status: "REJECTED" }),
    });
    expect(captureMessageMock).toHaveBeenCalled();
  });
});
