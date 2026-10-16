import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, summariseExperiment, trainGlobalSignals, getLatestGlobalSignals } = vi.hoisted(() => ({
  dbMock: {
    contentExperiment: { findFirst: vi.fn() },
    aiAutoAction: { count: vi.fn(), create: vi.fn() },
  },
  summariseExperiment: vi.fn(),
  trainGlobalSignals: vi.fn(),
  getLatestGlobalSignals: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/ai/content-local-optimizer", () => ({ summariseExperiment }));
vi.mock("@/lib/ai/content-global-optimizer", () => ({ trainGlobalSignals, getLatestGlobalSignals }));
vi.mock("@/lib/ai/webhooks", () => ({ dispatchWebhookAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/auditLogger", () => ({
  logAuditEvent: vi.fn(),
  AuditAction: { AI_AUTO_ACTION: "AI_AUTO_ACTION", AI_AUTO_REVERT: "AI_AUTO_REVERT" },
  AuditEntity: { AI_AUTO_ACTION: "AiAutoAction" },
}));

import { NO_SERVER_RECOMMENDATION, SLOT_MISMATCH, applyScheduleRecommendation, type ScheduleRecommendation } from "@/lib/ai/scheduler";

const ORG = "org-sched";

/** A local SCHEDULE experiment whose best variant (Rabu 10:00) has the given server-side confidence. */
const serverRecommends = (confidence: number) => {
  dbMock.contentExperiment.findFirst.mockResolvedValue({ id: 7 });
  summariseExperiment.mockResolvedValue({
    variants: [
      {
        variant: { payload: { schedule: { day: "Rabu", hour: 10 } }, confidence },
        performance: { impressions: 120 },
        engagement: { score: 0.4 },
      },
    ],
  });
};

const clientRecommendation = (overrides: Partial<ScheduleRecommendation> = {}): ScheduleRecommendation => ({
  recommendedAt: new Date().toISOString(),
  day: "Rabu",
  hour: 10,
  confidence: 0.99,
  reason: "client reason",
  quotaRemaining: 1,
  limit: 1,
  autoEligible: true,
  source: "local",
  ...overrides,
});

const apply = (recommendation = clientRecommendation()) =>
  applyScheduleRecommendation({ organizationId: ORG, contentId: 42, recommendation });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_SA_MAX_AUTOPUBLISH_PER_DAY = "1";
  dbMock.aiAutoAction.count.mockResolvedValue(0);
  dbMock.aiAutoAction.create.mockImplementation(async ({ data }) => ({ id: 1, status: "applied", ...data }));
  trainGlobalSignals.mockResolvedValue(undefined);
  getLatestGlobalSignals.mockResolvedValue([]);
});

describe("applyScheduleRecommendation", () => {
  it("gates on the server-side confidence and logs it, ignoring the client value", async () => {
    serverRecommends(0.76);

    const result = await apply(clientRecommendation({ confidence: 0.1 }));

    expect(result).toMatchObject({ applied: true, evaluation: { decision: "auto", quotaRemaining: 0, limit: 1 } });
    expect(dbMock.aiAutoAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "SCHEDULE_UPDATE", confidence: 0.76, contentId: 42 }),
    });
  });

  it("does not auto-apply when only the client claims a high confidence", async () => {
    serverRecommends(0.6);

    const result = await apply(clientRecommendation({ confidence: 0.99 }));

    expect(result).toMatchObject({ applied: false, evaluation: { decision: "needs_approval" } });
    expect(result.evaluation.reason).toContain("Confidence 0.60");
    expect(dbMock.aiAutoAction.create).not.toHaveBeenCalled();
  });

  it("needs approval when the server has no recommendation for the content", async () => {
    dbMock.contentExperiment.findFirst.mockResolvedValue(null);

    const result = await apply();

    expect(result).toMatchObject({
      applied: false,
      message: NO_SERVER_RECOMMENDATION,
      evaluation: { decision: "needs_approval", quotaRemaining: 1, limit: 1 },
    });
    expect(dbMock.aiAutoAction.create).not.toHaveBeenCalled();
  });

  it("needs approval when the client asks for a different slot than the server recommends", async () => {
    serverRecommends(0.9);

    const result = await apply(clientRecommendation({ day: "Senin", hour: 9 }));

    expect(result).toMatchObject({ applied: false, message: SLOT_MISMATCH });
    expect(dbMock.aiAutoAction.create).not.toHaveBeenCalled();
  });

  it("is blocked once today's SCHEDULE_UPDATE actions use up the quota", async () => {
    serverRecommends(0.9);
    dbMock.aiAutoAction.count.mockResolvedValue(1);

    const result = await apply();

    expect(result).toMatchObject({
      applied: false,
      message: "Kuota autopublish harian habis",
      evaluation: { decision: "needs_approval", quotaRemaining: 0 },
    });
    expect(dbMock.aiAutoAction.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: ORG,
        actionType: { in: ["AUTOPUBLISH", "SCHEDULE_UPDATE"] },
        status: "applied",
      }),
    });
    expect(dbMock.aiAutoAction.create).not.toHaveBeenCalled();
  });
});
