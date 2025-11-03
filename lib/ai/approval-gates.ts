import { AutoActionStatus, AutoActionType, ExperimentAxis, type AiAutoAction } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";

const DEFAULT_MIN_SAMPLE = 50;

const autoPublishConfigSchema = z.object({
  minSampleSize: z.number().int().positive().default(DEFAULT_MIN_SAMPLE),
  scheduleConfidence: z.number().min(0).max(1).default(0.75),
  defaultConfidence: z.number().min(0).max(1).default(0.8),
});

export type AutoPublishEvaluation = {
  decision: "auto" | "needs_approval";
  reason: string;
  quotaRemaining: number;
  limit: number;
};

const startOfDay = (value: Date) => {
  const result = new Date(value);
  result.setUTCHours(0, 0, 0, 0);
  return result;
};

const getQuotaLimit = () => {
  const raw = process.env.AI_SA_MAX_AUTOPUBLISH_PER_DAY ?? "2";
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 2 : parsed;
};

export const getAutoPublishUsage = async (organizationId?: string) => {
  if (!organizationId) {
    return { used: 0, remaining: 0, limit: 0 };
  }

  const now = new Date();
  const start = startOfDay(now);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const limit = getQuotaLimit();

  const used = await db.aiAutoAction.count({
    where: {
      organizationId,
      actionType: AutoActionType.AUTOPUBLISH,
      createdAt: { gte: start, lt: end },
      status: AutoActionStatus.applied,
    },
  });

  return {
    used,
    remaining: Math.max(limit - used, 0),
    limit,
  };
};

export const evaluateAutoPublish = async ({
  organizationId,
  axis,
  confidence,
  sampleSize,
  highStakes,
  minSampleSize,
}: {
  organizationId?: string;
  axis: ExperimentAxis;
  confidence: number;
  sampleSize: number;
  highStakes?: boolean;
  minSampleSize?: number;
}): Promise<AutoPublishEvaluation> => {
  const quota = await getAutoPublishUsage(organizationId);
  const config = autoPublishConfigSchema.parse({ minSampleSize: minSampleSize ?? DEFAULT_MIN_SAMPLE });

  if (!organizationId) {
    return {
      decision: "needs_approval",
      reason: "Organisasi tidak dikenali untuk quota SA",
      quotaRemaining: quota.remaining,
      limit: quota.limit,
    };
  }

  if (quota.remaining <= 0) {
    return {
      decision: "needs_approval",
      reason: "Kuota autopublish harian habis",
      quotaRemaining: quota.remaining,
      limit: quota.limit,
    };
  }

  if (highStakes && axis === ExperimentAxis.CTA) {
    return {
      decision: "needs_approval",
      reason: "CTA high-stakes wajib approval manual",
      quotaRemaining: quota.remaining,
      limit: quota.limit,
    };
  }

  if (sampleSize < config.minSampleSize) {
    return {
      decision: "needs_approval",
      reason: `Sample belum memenuhi ambang minimal (${config.minSampleSize})`,
      quotaRemaining: quota.remaining,
      limit: quota.limit,
    };
  }

  const threshold = axis === ExperimentAxis.SCHEDULE ? config.scheduleConfidence : config.defaultConfidence;
  if (confidence < threshold) {
    return {
      decision: "needs_approval",
      reason: `Confidence ${confidence.toFixed(2)} < ambang ${threshold.toFixed(2)}`,
      quotaRemaining: quota.remaining,
      limit: quota.limit,
    };
  }

  return {
    decision: "auto",
    reason: "Memenuhi threshold confidence, sample, dan quota",
    quotaRemaining: quota.remaining - 1,
    limit: quota.limit,
  };
};

export const logAutoAction = async ({
  organizationId,
  actionType,
  contentId,
  experimentId,
  variantId,
  reason,
  confidence,
}: {
  organizationId?: string;
  actionType: AutoActionType;
  contentId?: number;
  experimentId?: number;
  variantId?: number;
  reason: string;
  confidence?: number;
}) => {
  return db.aiAutoAction.create({
    data: {
      organizationId,
      actionType,
      contentId,
      experimentId,
      variantId,
      reason,
      confidence,
    },
  });
};

export const markAutoActionReverted = async ({ actionId, reason }: { actionId: number; reason?: string }) => {
  return db.aiAutoAction.update({
    where: { id: actionId },
    data: { status: AutoActionStatus.reverted, reason: reason ?? "Manual revert" },
  });
};

export const serializeAutoAction = (action: AiAutoAction) => ({
  ...action,
  createdAt: action.createdAt.toISOString(),
  updatedAt: action.updatedAt.toISOString(),
});
