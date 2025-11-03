import { AutoActionType, ExperimentAxis, ExperimentStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { evaluateAutoPublish, logAutoAction } from "@/lib/ai/approval-gates";
import { getLatestGlobalSignals, trainGlobalSignals } from "@/lib/ai/content-global-optimizer";
import { summariseExperiment } from "@/lib/ai/content-local-optimizer";

const LOW_RISK_HOURS = new Set([9, 10, 11, 14, 15, 16, 20]);
const DAY_MAP: Record<string, number> = {
  Minggu: 0,
  Senin: 1,
  Selasa: 2,
  Rabu: 3,
  Kamis: 4,
  Jumat: 5,
  Sabtu: 6,
};

const DAY_NAMES = Object.keys(DAY_MAP);

type ScheduleWindow = { day?: string; hour?: number; window?: string; timezone?: string };
type ScheduleInsight = { day: string; hour: number; score?: number; support?: number };

const extractSchedule = (
  payload: unknown,
): ScheduleWindow | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const schedule = (payload as Record<string, unknown>).schedule;
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    return null;
  }

  const scheduleRecord = schedule as Record<string, unknown>;
  return {
    day: typeof scheduleRecord.day === "string" ? scheduleRecord.day : undefined,
    hour: typeof scheduleRecord.hour === "number" ? scheduleRecord.hour : undefined,
    window: typeof scheduleRecord.window === "string" ? scheduleRecord.window : undefined,
    timezone: typeof scheduleRecord.timezone === "string" ? scheduleRecord.timezone : undefined,
  };
};

const extractScheduleInsights = (payload: unknown): ScheduleInsight[] => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const insights = (payload as Record<string, unknown>).scheduleInsights;
  if (!Array.isArray(insights)) return [];

  return insights.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [] as ScheduleInsight[];
    const insight = entry as Record<string, unknown>;
    if (typeof insight.day !== "string" || typeof insight.hour !== "number") return [] as ScheduleInsight[];

    return [
      {
        day: insight.day,
        hour: insight.hour,
        score: typeof insight.score === "number" ? insight.score : undefined,
        support: typeof insight.support === "number" ? insight.support : undefined,
      },
    ];
  });
};

export type ScheduleRecommendation = {
  recommendedAt: string;
  day: string;
  hour: number;
  confidence: number;
  reason: string;
  quotaRemaining: number;
  limit: number;
  autoEligible: boolean;
  source: "local" | "global";
};

const nextOccurrence = (day: string, hour: number) => {
  const now = new Date();
  const base = new Date(now);
  base.setMinutes(0, 0, 0);

  const targetDayIndex = DAY_MAP[day] ?? now.getDay();
  const currentDayIndex = now.getDay();
  let delta = targetDayIndex - currentDayIndex;
  if (delta < 0 || (delta === 0 && hour <= now.getHours())) {
    delta += 7;
  }

  base.setDate(base.getDate() + delta);
  base.setHours(hour);
  return base;
};

const ensureLowRiskHour = (hour: number) => {
  if (LOW_RISK_HOURS.has(hour)) return hour;
  const candidates = Array.from(LOW_RISK_HOURS);
  candidates.sort((a, b) => Math.abs(a - hour) - Math.abs(b - hour));
  return candidates[0] ?? hour;
};

const findBestLocalSchedule = async (organizationId: string | undefined, contentId: number) => {
  const experiment = await db.contentExperiment.findFirst({
    where: {
      organizationId,
      contentId,
      axis: ExperimentAxis.SCHEDULE,
      status: { in: [ExperimentStatus.running, ExperimentStatus.completed] },
    },
    orderBy: { startAt: "desc" },
  });

  if (!experiment) return null;
  const summary = await summariseExperiment(experiment.id);
  if (!summary) return null;

  const candidates = summary.variants
    .map((variant) => ({
      variant,
      schedule: extractSchedule(variant.variant.payload),
    }))
    .filter(
      (
        entry,
      ): entry is {
        variant: (typeof summary.variants)[number];
        schedule: ScheduleWindow;
      } =>
        entry.variant.performance.impressions > 0 &&
        Boolean(entry.schedule?.day) &&
        typeof entry.schedule?.hour === "number",
    )
    .sort((a, b) => b.variant.engagement.score - a.variant.engagement.score);

  const best = candidates?.[0];
  if (!best) return null;

  const schedule = best.schedule;
  if (!schedule.day || typeof schedule.hour !== "number") return null;

  return {
    day: schedule.day,
    hour: ensureLowRiskHour(schedule.hour),
    confidence: best.variant.variant.confidence ?? 0.75,
    reason: `Varian dengan skor tertinggi (${(best.variant.engagement.score * 100).toFixed(1)}%)`,
  };
};

const deriveFromGlobalSignals = async (organizationId?: string) => {
  await trainGlobalSignals({ organizationId });
  const signals = await getLatestGlobalSignals({ organizationId, axis: ExperimentAxis.SCHEDULE });
  const first = signals.find((signal) => extractScheduleInsights(signal.signal).length > 0);
  const [slot] = extractScheduleInsights(first?.signal);

  if (!slot) {
    return null;
  }

  const fallbackDayIndex =
    typeof slot.day === "number" ? slot.day : Number.isFinite(Number(slot.day)) ? Number(slot.day) : undefined;
  const fallbackDay =
    typeof fallbackDayIndex === "number" && Number.isInteger(fallbackDayIndex) && fallbackDayIndex >= 0
      ? DAY_NAMES[fallbackDayIndex] ?? undefined
      : undefined;
  const day = Object.prototype.hasOwnProperty.call(DAY_MAP, slot.day)
    ? slot.day
    : fallbackDay ?? "Senin";
  return {
    day,
    hour: ensureLowRiskHour(slot.hour),
    confidence: 0.72,
    reason: `Mengikuti sinyal global window ${first?.window ?? "30d"}`,
  };
};

export const recommendSchedule = async ({
  organizationId,
  contentId,
}: {
  organizationId?: string;
  contentId: number;
}): Promise<ScheduleRecommendation | null> => {
  const local = await findBestLocalSchedule(organizationId, contentId);
  const candidate = local ?? (await deriveFromGlobalSignals(organizationId));
  if (!candidate) return null;

  const next = nextOccurrence(candidate.day, candidate.hour);
  const evaluation = await evaluateAutoPublish({
    organizationId,
    axis: ExperimentAxis.SCHEDULE,
    confidence: candidate.confidence,
    sampleSize: local ? local.confidence * 100 : 60,
  });

  return {
    recommendedAt: next.toISOString(),
    day: candidate.day,
    hour: candidate.hour,
    confidence: candidate.confidence,
    reason: candidate.reason,
    quotaRemaining: evaluation.quotaRemaining,
    limit: evaluation.limit,
    autoEligible: evaluation.decision === "auto",
    source: local ? "local" : "global",
  };
};

export const applyScheduleRecommendation = async ({
  organizationId,
  contentId,
  experimentId,
  variantId,
  recommendation,
}: {
  organizationId?: string;
  contentId: number;
  experimentId?: number;
  variantId?: number;
  recommendation: ScheduleRecommendation;
}) => {
  const evaluation = await evaluateAutoPublish({
    organizationId,
    axis: ExperimentAxis.SCHEDULE,
    confidence: recommendation.confidence,
    sampleSize: Math.max(Math.round(recommendation.confidence * 120), 60),
  });

  if (evaluation.decision !== "auto") {
    return {
      applied: false,
      evaluation,
      message: evaluation.reason,
    } as const;
  }

  const action = await logAutoAction({
    organizationId,
    actionType: AutoActionType.SCHEDULE_UPDATE,
    contentId,
    experimentId,
    variantId,
    confidence: recommendation.confidence,
    reason: `Auto schedule ${recommendation.day} ${recommendation.hour}:00 — ${recommendation.reason}`,
  });

  return {
    applied: true,
    evaluation: { ...evaluation, quotaRemaining: Math.max(evaluation.quotaRemaining, 0) },
    action,
  } as const;
};
