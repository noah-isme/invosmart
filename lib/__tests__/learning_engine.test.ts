import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMetricsMock = vi.fn();
const processAutoRollbackMock = vi.fn().mockResolvedValue([]);
const chatCreateMock = vi.fn();

vi.mock("@prisma/client", () => ({
  OptimizationStatus: {
    PENDING: "PENDING",
    APPLIED: "APPLIED",
    REJECTED: "REJECTED",
  },
}));

vi.mock("@/lib/ai/optimizer", () => ({
  fetchMetrics: fetchMetricsMock,
}));

vi.mock("@/lib/ai/rollback", () => ({
  processAutoRollback: processAutoRollbackMock,
}));

vi.mock("@/lib/ai", () => ({
  DEFAULT_MODEL: "test-model",
  createClient: () => ({
    chat: {
      completions: {
        create: chatCreateMock,
      },
    },
  }),
}));

type MockLearningProfile = {
  route: string;
  successRate: number;
  avgImpact: number;
  confidenceWeight: number;
  totalEvaluations: number;
  lastLcpP95: number;
  lastInpP95: number;
  lastApiLatencyP95: number;
  lastErrorRate: number;
  lastEval: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type MockOptimizationLog = {
  id: string;
  route: string;
  status: "PENDING" | "APPLIED" | "REJECTED";
  createdAt: Date;
  updatedAt: Date;
  notes: string | null;
  change: string;
  impact: string;
  confidence: number;
  actor: string;
  rollback: boolean;
  deltaImpact: number;
  evalConfidence: number;
};

const learningProfiles = new Map<string, MockLearningProfile>();
const optimizationLogs = new Map<string, MockOptimizationLog>();

vi.mock("@/lib/db", () => ({
  db: {
    learningProfile: {
      findMany: vi.fn(async ({ where }: { where?: { route?: { in: string[] } } }) => {
        const all = Array.from(learningProfiles.values());
        if (!where?.route?.in) return all;
        return where.route.in
          .map((route) => learningProfiles.get(route))
          .filter((profile): profile is MockLearningProfile => Boolean(profile));
      }),
      findUnique: vi.fn(async ({ where: { route } }: { where: { route: string } }) => learningProfiles.get(route) ?? null),
      create: vi.fn(async ({ data }: { data: Partial<MockLearningProfile> & { route: string } }) => {
        const base: MockLearningProfile = {
          route: data.route,
          successRate: data.successRate ?? 0,
          avgImpact: data.avgImpact ?? 0,
          confidenceWeight: data.confidenceWeight ?? 0.7,
          totalEvaluations: data.totalEvaluations ?? 0,
          lastLcpP95: data.lastLcpP95 ?? 0,
          lastInpP95: data.lastInpP95 ?? 0,
          lastApiLatencyP95: data.lastApiLatencyP95 ?? 0,
          lastErrorRate: data.lastErrorRate ?? 0,
          lastEval: data.lastEval ?? null,
          createdAt: data.createdAt ?? new Date(),
          updatedAt: data.updatedAt ?? new Date(),
        };
        learningProfiles.set(base.route, base);
        return base;
      }),
      update: vi.fn(async ({ where: { route }, data }: { where: { route: string }; data: Partial<MockLearningProfile> }) => {
        const current = learningProfiles.get(route) ?? ({
          route,
          successRate: 0,
          avgImpact: 0,
          confidenceWeight: 0.7,
          totalEvaluations: 0,
          lastLcpP95: 0,
          lastInpP95: 0,
          lastApiLatencyP95: 0,
          lastErrorRate: 0,
          lastEval: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as MockLearningProfile);
        const updated: MockLearningProfile = { ...current, ...data, updatedAt: data.updatedAt ?? new Date() };
        learningProfiles.set(route, updated);
        return updated;
      }),
    },
    optimizationLog: {
      findMany: vi.fn(async () => Array.from(optimizationLogs.values())),
      update: vi.fn(async ({ where: { id }, data }: { where: { id: string }; data: Partial<MockOptimizationLog> }) => {
        const current =
          optimizationLogs.get(id) ??
          ({
            id,
            route: "",
            status: "PENDING",
            createdAt: new Date(),
            updatedAt: new Date(),
            notes: null,
            change: "",
            impact: "",
            confidence: 0.7,
            actor: "system",
            rollback: false,
            deltaImpact: 0,
            evalConfidence: 0.7,
          } as MockOptimizationLog);
        const updated: MockOptimizationLog = { ...current, ...data, updatedAt: data.updatedAt ?? new Date() };
        optimizationLogs.set(id, updated);
        return updated;
      }),
    },
  },
}));

const { runLearningCycle } = await import("@/lib/ai/learning");

const baseProfile: MockLearningProfile = {
  route: "/app/dashboard",
  successRate: 0.5,
  avgImpact: 0.02,
  confidenceWeight: 0.75,
  totalEvaluations: 4,
  lastLcpP95: 4000,
  lastInpP95: 200,
  lastApiLatencyP95: 500,
  lastErrorRate: 0.02,
  lastEval: new Date("2024-01-01T00:00:00Z"),
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

const baseLog: MockOptimizationLog = {
  id: "log-1",
  route: "/app/dashboard",
  status: "APPLIED",
  createdAt: new Date("2024-01-02T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
  notes: null,
  change: "Optimize hero",
  impact: "Improve LCP",
  confidence: 0.8,
  actor: "system",
  rollback: false,
  deltaImpact: 0,
  evalConfidence: 0.8,
};

describe("learning engine", () => {
  beforeEach(() => {
    learningProfiles.clear();
    optimizationLogs.clear();
    learningProfiles.set(baseProfile.route, { ...baseProfile });
    optimizationLogs.set(baseLog.id, { ...baseLog });
    fetchMetricsMock.mockReset();
    processAutoRollbackMock.mockReset();
    chatCreateMock.mockReset();
  });

  it("updates learning profile with positive improvements", async () => {
    fetchMetricsMock.mockResolvedValueOnce([
      {
        route: "/app/dashboard",
        lcpP95: 3600,
        inpP95: 180,
        apiLatencyP95: 450,
        errorRate: 0.015,
        sampleSize: 120,
      },
    ]);

    chatCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "Insight" } }],
    });

    const result = await runLearningCycle({ negativeThreshold: -0.05 });

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0]?.compositeImpact).toBeGreaterThan(0);
    expect(processAutoRollbackMock).not.toHaveBeenCalled();

    const updatedProfile = learningProfiles.get(baseProfile.route);
    expect(updatedProfile?.successRate).toBeGreaterThan(baseProfile.successRate);
    expect(updatedProfile?.confidenceWeight).toBeGreaterThan(0.74);
  });

  it("triggers rollback on negative regression", async () => {
    fetchMetricsMock.mockResolvedValueOnce([
      {
        route: "/app/dashboard",
        lcpP95: 4600,
        inpP95: 240,
        apiLatencyP95: 620,
        errorRate: 0.03,
        sampleSize: 80,
      },
    ]);

    chatCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "Insight" } }],
    });

    const result = await runLearningCycle({ negativeThreshold: -0.05 });

    expect(result.evaluations[0]?.rollbackTriggered).toBe(true);
    expect(processAutoRollbackMock).toHaveBeenCalledWith(expect.any(Array), expect.any(Number));

    const updatedLog = optimizationLogs.get(baseLog.id);
    expect(updatedLog?.rollback).toBe(true);
  });
});
