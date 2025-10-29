import { OptimizationStatus, type LearningProfile as LearningProfileModel } from "@prisma/client";
import { z } from "zod";

import { DEFAULT_MODEL, createClient } from "@/lib/ai";
import { db } from "@/lib/db";
import type { ObservabilityMetric, OptimizationRecommendation } from "@/lib/ai/optimizer";
import { processAutoRollback } from "@/lib/ai/rollback";

const evaluationOptionsSchema = z.object({
  intervalMinutes: z.number().int().min(5).max(24 * 60).default(60),
  negativeThreshold: z.number().min(-1).max(0).default(-0.05),
  model: z.string().default(DEFAULT_MODEL),
});

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const ensureRouteFormat = (route: string) => (route.startsWith("/") ? route : `/${route}`);

const calculatePercentDelta = (previous: number, current: number) => {
  if (!Number.isFinite(previous) || previous === 0) return 0;
  if (!Number.isFinite(current)) return 0;
  return (previous - current) / previous;
};

const fetchLatestMetrics = async (intervalMinutes: number): Promise<ObservabilityMetric[]> => {
  const optimizerModule = await import("@/lib/ai/optimizer");
  return optimizerModule.fetchMetrics({ intervalMinutes });
};

export type LearningEvaluation = {
  route: string;
  deltaLcp: number;
  deltaInp: number;
  deltaLatency: number;
  deltaErrorRate: number;
  compositeImpact: number;
  rollbackTriggered: boolean;
  newConfidence: number;
  logsEvaluated: number;
};

const buildCompositeImpact = (deltaLcp: number, deltaInp: number, deltaLatency: number, deltaErrorRate: number) => {
  const weights = {
    lcp: 0.35,
    inp: 0.25,
    latency: 0.25,
    errors: 0.15,
  };

  return (
    deltaLcp * weights.lcp +
    deltaInp * weights.inp +
    deltaLatency * weights.latency +
    deltaErrorRate * weights.errors
  );
};

const createOrGetProfile = async (route: string): Promise<LearningProfileModel> => {
  const normalizedRoute = ensureRouteFormat(route);
  const existing = await db.learningProfile.findUnique({ where: { route: normalizedRoute } });
  if (existing) return existing;
  return db.learningProfile.create({
    data: {
      route: normalizedRoute,
      lastEval: null,
    },
  });
};

const updateProfileStats = async (
  profile: LearningProfileModel,
  metrics: ObservabilityMetric,
  compositeImpact: number,
  wasSuccessful: boolean,
  newConfidence: number,
) => {
  const total = profile.totalEvaluations + 1;
  const successRate = ((profile.successRate * profile.totalEvaluations) + (wasSuccessful ? 1 : 0)) / total;
  const avgImpact = ((profile.avgImpact * profile.totalEvaluations) + compositeImpact) / total;

  return db.learningProfile.update({
    where: { route: profile.route },
    data: {
      successRate,
      avgImpact,
      confidenceWeight: newConfidence,
      totalEvaluations: total,
      lastLcpP95: metrics.lcpP95,
      lastInpP95: metrics.inpP95,
      lastApiLatencyP95: metrics.apiLatencyP95,
      lastErrorRate: metrics.errorRate,
      lastEval: new Date(),
    },
  });
};

const evaluateLogsForRoute = async (
  profile: LearningProfileModel,
  metrics: ObservabilityMetric,
  logs: Awaited<ReturnType<typeof db.optimizationLog.findMany>>,
  negativeThreshold: number,
): Promise<LearningEvaluation | null> => {
  if (!logs.length) {
    await db.learningProfile.update({
      where: { route: profile.route },
      data: {
        lastLcpP95: metrics.lcpP95,
        lastInpP95: metrics.inpP95,
        lastApiLatencyP95: metrics.apiLatencyP95,
        lastErrorRate: metrics.errorRate,
        lastEval: new Date(),
      },
    });
    return null;
  }

  const deltaLcp = calculatePercentDelta(profile.lastLcpP95, metrics.lcpP95);
  const deltaInp = calculatePercentDelta(profile.lastInpP95, metrics.inpP95);
  const deltaLatency = calculatePercentDelta(profile.lastApiLatencyP95, metrics.apiLatencyP95);
  const deltaErrorRate = calculatePercentDelta(profile.lastErrorRate, metrics.errorRate);
  const compositeImpact = buildCompositeImpact(deltaLcp, deltaInp, deltaLatency, deltaErrorRate);

  const appliedLogs = logs.filter((log) => log.status === OptimizationStatus.APPLIED);
  const rejectedLogs = logs.filter((log) => log.status === OptimizationStatus.REJECTED);

  const wasSuccessful = compositeImpact >= 0 || rejectedLogs.length > appliedLogs.length;

  const shift = clamp(compositeImpact, -0.1, 0.1);
  const newConfidence = clamp(profile.confidenceWeight + shift, 0.5, 0.95);

  await updateProfileStats(profile, metrics, compositeImpact, wasSuccessful, newConfidence);

  const rollbackTriggered = compositeImpact <= negativeThreshold;

  await Promise.all(
    logs.map((log) =>
      db.optimizationLog.update({
        where: { id: log.id },
        data: {
          deltaImpact: compositeImpact,
          evalConfidence: newConfidence,
          rollback: rollbackTriggered && log.status === OptimizationStatus.APPLIED,
        },
      }),
    ),
  );

  if (rollbackTriggered && appliedLogs.length) {
    await processAutoRollback(appliedLogs, compositeImpact);
  }

  return {
    route: profile.route,
    deltaLcp,
    deltaInp,
    deltaLatency,
    deltaErrorRate,
    compositeImpact,
    rollbackTriggered,
    newConfidence,
    logsEvaluated: logs.length,
  };
};

const summarizeInsights = async (evaluations: LearningEvaluation[], model: string) => {
  if (!evaluations.length) return null;

  try {
    const client = createClient();
    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Anda adalah analis pembelajaran AI. Rangkum tiga insight utama dari data performa dan sarankan iterasi berikutnya.",
        },
        {
          role: "user",
          content: JSON.stringify(
            evaluations.map((evaluation) => ({
              route: evaluation.route,
              compositeImpact: evaluation.compositeImpact,
              rollbackTriggered: evaluation.rollbackTriggered,
              newConfidence: evaluation.newConfidence,
            })),
          ),
        },
      ],
    });

    return response.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.warn("Failed to generate learning insight", error);
    return null;
  }
};

export const runLearningCycle = async (options?: Partial<z.infer<typeof evaluationOptionsSchema>>) => {
  if (process.env.ENABLE_AI_LEARNING === "false") {
    return { evaluations: [], insight: null };
  }

  const { intervalMinutes, negativeThreshold, model } = evaluationOptionsSchema.parse(options ?? {});
  const metrics = await fetchLatestMetrics(intervalMinutes);

  if (!metrics.length) {
    return { evaluations: [], insight: null };
  }

  const routes = metrics.map((metric) => ensureRouteFormat(metric.route));

  const [profiles, logs] = await Promise.all([
    db.learningProfile.findMany({ where: { route: { in: routes } } }),
    db.optimizationLog.findMany({
      where: {
        route: { in: routes },
        status: { in: [OptimizationStatus.APPLIED, OptimizationStatus.REJECTED] },
      },
      orderBy: { updatedAt: "asc" },
    }),
  ]);

  const profileMap = new Map(profiles.map((profile) => [profile.route, profile]));
  const logsByRoute = new Map<string, typeof logs>();

  logs.forEach((log) => {
    const normalizedRoute = ensureRouteFormat(log.route);
    const profile = profileMap.get(normalizedRoute);
    const since = profile?.lastEval ?? new Date(0);
    if (log.updatedAt <= since) return;

    if (!logsByRoute.has(normalizedRoute)) {
      logsByRoute.set(normalizedRoute, []);
    }
    logsByRoute.get(normalizedRoute)?.push(log);
  });

  const evaluations: LearningEvaluation[] = [];

  for (const metric of metrics) {
    const route = ensureRouteFormat(metric.route);
    let profile = profileMap.get(route);
    if (!profile) {
      profile = await createOrGetProfile(route);
      profileMap.set(route, profile);
    }
    const routeLogs = logsByRoute.get(route) ?? [];

    const evaluation = await evaluateLogsForRoute(profile, metric, routeLogs, negativeThreshold);
    if (evaluation) {
      evaluations.push(evaluation);
    }
  }

  const insight = await summarizeInsights(evaluations, model);

  return { evaluations, insight };
};

export const applyConfidenceRecalibration = async (
  recommendations: OptimizationRecommendation[] | null | undefined,
): Promise<OptimizationRecommendation[]> => {
  if (!recommendations?.length) {
    return recommendations ?? [];
  }
  if (process.env.ENABLE_AI_LEARNING === "false") {
    return recommendations;
  }

  const routes = recommendations.map((recommendation) => ensureRouteFormat(recommendation.route));
  const profiles = await db.learningProfile.findMany({ where: { route: { in: routes } } });
  const profileMap = new Map(profiles.map((profile) => [profile.route, profile]));

  return recommendations.map((recommendation) => {
    const normalizedRoute = ensureRouteFormat(recommendation.route);
    const profile = profileMap.get(normalizedRoute);
    if (!profile) return recommendation;

    const delta = clamp(profile.confidenceWeight - recommendation.confidence, -0.1, 0.1);
    const confidence = clamp(recommendation.confidence + delta, 0.5, 0.99);

    return {
      ...recommendation,
      confidence: Number(confidence.toFixed(2)),
    };
  });
};

export const getLearningDashboardData = async () => {
  const [profiles, logs] = await Promise.all([
    db.learningProfile.findMany({ orderBy: { route: "asc" } }),
    db.optimizationLog.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);

  return {
    profiles: profiles.map((profile) => ({
      ...profile,
      lastEval: profile.lastEval?.toISOString() ?? null,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    })),
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString(),
    })),
  };
};
