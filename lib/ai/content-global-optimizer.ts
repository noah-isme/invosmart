import { ExperimentAxis, ExperimentStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { computeEngagementScore } from "@/lib/ai/scoring";

type GlobalSignal = {
  axis: ExperimentAxis;
  window: string;
  topPerformers: {
    experimentId: number;
    variantId: number;
    organizationId?: string | null;
    score: number;
    ctr: number;
    conversions: number;
    dwellMs: number;
    summary: string;
  }[];
  scheduleInsights?: {
    day: string;
    hour: number;
    score: number;
    support: number;
  }[];
};

const WINDOWS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

const describeVariant = (axis: ExperimentAxis, payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "Varian AI";
  }

  const value = payload as Record<string, unknown>;
  if (axis === "HOOK" && typeof value.hook === "string") {
    return value.hook;
  }

  if (axis === "CAPTION" && typeof value.caption === "string") {
    return value.caption;
  }

  if (axis === "CTA" && typeof value.cta === "string") {
    return value.cta;
  }

  if (axis === "SCHEDULE" && typeof value.schedule === "object" && value.schedule) {
    const schedule = value.schedule as { day?: string; hour?: number; window?: string };
    return `${schedule.day ?? "Hari"} ${schedule.hour ?? ""} — ${schedule.window ?? "Slot"}`;
  }

  return "Varian AI";
};

const buildScheduleInsights = (
  variants: {
    payload: unknown;
    score: number;
    impressions: number;
  }[],
) => {
  const buckets = new Map<string, { day: string; hour: number; score: number; support: number }>();

  for (const variant of variants) {
    if (!variant.payload || typeof variant.payload !== "object") continue;
    const schedule = (variant.payload as Record<string, unknown>).schedule as
      | { day?: string; hour?: number; window?: string }
      | undefined;
    if (!schedule || typeof schedule.day !== "string" || typeof schedule.hour !== "number") continue;

    const key = `${schedule.day}-${schedule.hour}`;
    const entry = buckets.get(key) ?? {
      day: schedule.day,
      hour: schedule.hour,
      score: 0,
      support: 0,
    };

    entry.score += variant.score * Math.max(1, Math.log10(variant.impressions + 1));
    entry.support += variant.impressions;
    buckets.set(key, entry);
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
};

export const trainGlobalSignals = async ({ organizationId }: { organizationId?: string } = {}) => {
  const now = new Date();
  const signals: GlobalSignal[] = [];

  for (const window of WINDOWS) {
    const since = new Date(now.getTime() - window.days * 24 * 60 * 60 * 1000);

    const experiments = await db.contentExperiment.findMany({
      where: {
        startAt: { gte: since },
        status: { not: ExperimentStatus.stopped },
        ...(organizationId ? { organizationId } : {}),
      },
      include: {
        variants: { include: { metrics: true } },
      },
    });

    const byAxis = new Map<ExperimentAxis, GlobalSignal["topPerformers"]>();
    const scheduleCandidates: { payload: unknown; score: number; impressions: number }[] = [];

    for (const experiment of experiments) {
      for (const variant of experiment.variants) {
        const totals = variant.metrics.reduce(
          (acc, metric) => {
            acc.impressions += metric.impressions;
            acc.clicks += metric.clicks;
            acc.conversions += metric.conversions;
            acc.dwellMs += metric.dwellMs;
            return acc;
          },
          { impressions: 0, clicks: 0, conversions: 0, dwellMs: 0 },
        );

        if (totals.impressions === 0) continue;

        const engagement = computeEngagementScore(totals);
        const payloadSummary = describeVariant(experiment.axis, variant.payload);
        const bucket = byAxis.get(experiment.axis) ?? [];

        bucket.push({
          experimentId: experiment.id,
          variantId: variant.id,
          organizationId: experiment.organizationId,
          score: engagement.score,
          ctr: engagement.ctr,
          conversions: totals.conversions,
          dwellMs: totals.dwellMs,
          summary: payloadSummary,
        });

        byAxis.set(experiment.axis, bucket);

        if (experiment.axis === "SCHEDULE") {
          scheduleCandidates.push({
            payload: variant.payload,
            score: engagement.score,
            impressions: totals.impressions,
          });
        }
      }
    }

    for (const [axis, performers] of byAxis.entries()) {
      performers.sort((a, b) => b.score - a.score);
      const topPerformers = performers.slice(0, 5);

      const scheduleInsights = axis === "SCHEDULE" ? buildScheduleInsights(scheduleCandidates) : undefined;

      signals.push({ axis, window: window.label, topPerformers: topPerformers, scheduleInsights });

      const signalPayload = {
        topPerformers,
        scheduleInsights,
        window: window.label,
      };

      if (organizationId) {
        await db.globalContentSignal.upsert({
          where: {
            organizationId_axis_window: {
              organizationId,
              axis,
              window: window.label,
            },
          },
          update: { signal: signalPayload },
          create: {
            organizationId,
            axis,
            window: window.label,
            signal: signalPayload,
          },
        });
      } else {
        const existingGlobalSignal = await db.globalContentSignal.findFirst({
          where: {
            organizationId: null,
            axis,
            window: window.label,
          },
        });

        if (existingGlobalSignal) {
          await db.globalContentSignal.update({
            where: { id: existingGlobalSignal.id },
            data: { signal: signalPayload },
          });
        } else {
          await db.globalContentSignal.create({
            data: {
              organizationId: null,
              axis,
              window: window.label,
              signal: signalPayload,
            },
          });
        }
      }
    }
  }

  return signals;
};

export const getLatestGlobalSignals = async ({
  organizationId,
  axis,
}: {
  organizationId?: string;
  axis?: ExperimentAxis;
} = {}) => {
  const signals = await db.globalContentSignal.findMany({
    where: {
      organizationId: organizationId ?? null,
      axis,
    },
    orderBy: { createdAt: "desc" },
  });

  return signals.map((record) => ({
    axis: record.axis,
    window: record.window,
    signal: record.signal,
    createdAt: record.createdAt,
  }));
};
