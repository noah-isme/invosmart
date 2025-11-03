import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AutoActionStatus, AutoActionType, ExperimentAxis } from "@prisma/client";

type AiAutoActionMock = {
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const { aiAutoActionMock, prismaEnums } = vi.hoisted(() => ({
  aiAutoActionMock: {
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } as AiAutoActionMock,
  prismaEnums: {
    AutoActionType: {
      AUTOPUBLISH: "AUTOPUBLISH",
      SCHEDULE_UPDATE: "SCHEDULE_UPDATE",
      AUTO_REVERT: "AUTO_REVERT",
      AUTO_CTA_TUNE: "AUTO_CTA_TUNE",
    },
    AutoActionStatus: {
      applied: "applied",
      reverted: "reverted",
      failed: "failed",
    },
    ExperimentAxis: {
      HOOK: "HOOK",
      CAPTION: "CAPTION",
      CTA: "CTA",
      SCHEDULE: "SCHEDULE",
    },
  },
}));

const HOOK = prismaEnums.ExperimentAxis.HOOK as ExperimentAxis;
const CTA = prismaEnums.ExperimentAxis.CTA as ExperimentAxis;
const AUTOPUBLISH = prismaEnums.AutoActionType.AUTOPUBLISH as AutoActionType;
const APPLIED = prismaEnums.AutoActionStatus.applied as AutoActionStatus;
const REVERTED = prismaEnums.AutoActionStatus.reverted as AutoActionStatus;

vi.mock("@prisma/client", () => prismaEnums);

vi.mock("@/lib/db", () => ({
  db: {
    aiAutoAction: aiAutoActionMock,
  },
}));

import { evaluateAutoPublish, getAutoPublishUsage, logAutoAction, markAutoActionReverted } from "@/lib/ai/approval-gates";

describe("approval gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enforces quota and confidence thresholds", async () => {
    aiAutoActionMock.count.mockResolvedValue(0);

    const evaluation = await evaluateAutoPublish({
      organizationId: "11111111-1111-1111-1111-111111111111",
      axis: HOOK,
      confidence: 0.9,
      sampleSize: 120,
    });

    expect(evaluation.decision).toBe("auto");
    expect(aiAutoActionMock.count).toHaveBeenCalled();
  });

  it("denies when confidence below threshold", async () => {
    aiAutoActionMock.count.mockResolvedValue(0);

    const evaluation = await evaluateAutoPublish({
      organizationId: "11111111-1111-1111-1111-111111111111",
      axis: CTA,
      confidence: 0.5,
      sampleSize: 200,
      highStakes: true,
    });

    expect(evaluation.decision).toBe("needs_approval");
  });

  it("records and reverts auto actions", async () => {
    aiAutoActionMock.create.mockResolvedValue({
      id: 1,
      organizationId: "org",
      actionType: AUTOPUBLISH,
      contentId: 1,
      experimentId: 1,
      variantId: 1,
      reason: "Test action",
      confidence: 0.85,
      status: APPLIED,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    aiAutoActionMock.update.mockResolvedValue({
      id: 1,
      organizationId: "org",
      actionType: AUTOPUBLISH,
      contentId: 1,
      experimentId: 1,
      variantId: 1,
      reason: "Rollback",
      confidence: 0.85,
      status: REVERTED,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const action = await logAutoAction({
      organizationId: "org",
      actionType: AUTOPUBLISH,
      contentId: 1,
      experimentId: 1,
      variantId: 1,
      reason: "Test action",
      confidence: 0.85,
    });

    expect(action.status).toBe(APPLIED);

    const reverted = await markAutoActionReverted({ actionId: 1, reason: "Rollback" });
    expect(reverted.status).toBe(REVERTED);
  });

  it("tracks usage per day", async () => {
    aiAutoActionMock.count.mockResolvedValue(1);

    const usage = await getAutoPublishUsage("org");
    expect(usage.used).toBe(1);
    expect(aiAutoActionMock.count).toHaveBeenCalled();
  });
});
