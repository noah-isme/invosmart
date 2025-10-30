import { OptimizationStatus, PolicyStatus } from "@prisma/client";
import { z } from "zod";

import { DEFAULT_MODEL, createClient } from "@/lib/ai";
import { db } from "@/lib/db";
import { applyConfidenceRecalibration } from "@/lib/ai/learning";
import { evaluatePolicy, isGovernanceEnabled, notifyPolicyViolation } from "@/lib/ai/policy";

const observabilityMetricSchema = z.object({
  route: z.string().min(1),
  lcpP95: z.number().nonnegative(),
  inpP95: z.number().nonnegative(),
  apiLatencyP95: z.number().nonnegative(),
  errorRate: z.number().min(0),
  sampleSize: z.number().nonnegative(),
});

export type ObservabilityMetric = z.infer<typeof observabilityMetricSchema>;

const recommendationSchema = z.object({
  route: z.string().min(1),
  suggestion: z.string().min(1),
  impact: z.string().min(1),
  confidence: z.number().min(0.7).max(1),
});

export type OptimizationRecommendation = z.infer<typeof recommendationSchema>;

const recommendationResponseSchema = z.object({
  recommendations: z.array(recommendationSchema),
});

const posthogRowSchema = z.object({
  route: z.string().min(1),
  lcpP95: z.number().optional(),
  p95_lcp: z.number().optional(),
  inpP95: z.number().optional(),
  p95_inp: z.number().optional(),
  apiLatencyP95: z.number().optional(),
  p95_latency: z.number().optional(),
  averageLatency: z.number().optional(),
  count: z.number().optional(),
});

const posthogResponseSchema = z.object({
  results: z.array(posthogRowSchema),
});

const sentryRowSchema = z.object({
  route: z.string().min(1),
  errorRate: z.number().min(0).max(1).optional(),
});

const sentryResponseSchema = z.object({
  data: z.array(sentryRowSchema),
});

type MutableMetric = {
  route: string;
  lcpP95: number;
  inpP95: number;
  apiLatencyP95: number;
  errorRate: number;
  sampleSize: number;
};

const CRITICAL_ROUTE_PREFIXES = ["/api", "/auth", "/admin", "/devtools"]; // devtools routes are manual only

const ensureRouteFormat = (route: string) => (route.startsWith("/") ? route : `/${route}`);

const ensureMetric = (map: Map<string, MutableMetric>, route: string): MutableMetric => {
  const normalizedRoute = ensureRouteFormat(route);
  const existing = map.get(normalizedRoute);

  if (existing) return existing;

  const created: MutableMetric = {
    route: normalizedRoute,
    lcpP95: 0,
    inpP95: 0,
    apiLatencyP95: 0,
    errorRate: 0,
    sampleSize: 0,
  };
  map.set(normalizedRoute, created);
  return created;
};

const isNonCriticalRoute = (route: string) => {
  const normalizedRoute = ensureRouteFormat(route);
  return !CRITICAL_ROUTE_PREFIXES.some((prefix) => normalizedRoute.startsWith(prefix));
};

const parseJsonFromResponse = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${response.url}: ${(error as Error).message}`);
  }
};

const collectPosthogMetrics = async (
  map: Map<string, MutableMetric>,
  intervalMinutes: number,
): Promise<void> => {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return;

  const url = `${process.env.POSTHOG_API_HOST ?? "https://app.posthog.com"}/api/projects/${projectId}/query/`;
  const body = {
    query: {
      kind: "PerformanceQuery",
      properties: [],
      breakdown_type: "session",
      interval: `${intervalMinutes}m`,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`PostHog query failed with status ${response.status}`);
  }

  const json = await parseJsonFromResponse(response);
  const parsed = posthogResponseSchema.safeParse(json);

  if (!parsed.success) {
    throw new Error(`Unexpected PostHog response: ${parsed.error.message}`);
  }

  parsed.data.results.forEach((row) => {
    const target = ensureMetric(map, row.route);
    target.lcpP95 = row.lcpP95 ?? row.p95_lcp ?? target.lcpP95;
    target.inpP95 = row.inpP95 ?? row.p95_inp ?? target.inpP95;
    target.apiLatencyP95 = row.apiLatencyP95 ?? row.p95_latency ?? row.averageLatency ?? target.apiLatencyP95;
    target.sampleSize = Math.max(target.sampleSize, row.count ?? target.sampleSize);
  });
};

const collectSentryMetrics = async (map: Map<string, MutableMetric>): Promise<void> => {
  const sentryToken = process.env.SENTRY_AUTH_TOKEN;
  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const projectSlug = process.env.SENTRY_PROJECT_SLUG;

  if (!sentryToken || !orgSlug || !projectSlug) return;

  const url = `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/issues/metrics/`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${sentryToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Sentry metrics failed with status ${response.status}`);
  }

  const json = await parseJsonFromResponse(response);
  const parsed = sentryResponseSchema.safeParse(json);

  if (!parsed.success) {
    throw new Error(`Unexpected Sentry response: ${parsed.error.message}`);
  }

  parsed.data.data.forEach((row) => {
    const target = ensureMetric(map, row.route);
    target.errorRate = row.errorRate ?? target.errorRate;
  });
};

export const fetchMetrics = async ({ intervalMinutes = 60 } = {}): Promise<ObservabilityMetric[]> => {
  const metrics = new Map<string, MutableMetric>();

  try {
    await collectPosthogMetrics(metrics, intervalMinutes);
  } catch (error) {
    console.warn("Failed to collect PostHog metrics", error);
  }

  try {
    await collectSentryMetrics(metrics);
  } catch (error) {
    console.warn("Failed to collect Sentry metrics", error);
  }

  return Array.from(metrics.values()).map((metric) =>
    observabilityMetricSchema.parse({
      route: metric.route,
      lcpP95: Number.isFinite(metric.lcpP95) ? metric.lcpP95 : 0,
      inpP95: Number.isFinite(metric.inpP95) ? metric.inpP95 : 0,
      apiLatencyP95: Number.isFinite(metric.apiLatencyP95) ? metric.apiLatencyP95 : 0,
      errorRate: Number.isFinite(metric.errorRate) ? metric.errorRate : 0,
      sampleSize: Number.isFinite(metric.sampleSize) ? metric.sampleSize : 0,
    }),
  );
};

const extractJsonFromMessage = (content: string) => {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  const payload = jsonMatch ? jsonMatch[1] : content;
  return JSON.parse(payload);
};

const buildFallbackRecommendations = (metrics: ObservabilityMetric[]): OptimizationRecommendation[] => {
  const recommendations = new Map<string, OptimizationRecommendation>();

  metrics.forEach((metric) => {
    if (!isNonCriticalRoute(metric.route)) return;

    if (metric.lcpP95 >= 3400) {
      recommendations.set(metric.route, {
        route: metric.route,
        suggestion: "Optimalkan komponen hero dan tunda render blok non-kritis menggunakan lazy loading.",
        impact: "Menurunkan LCP p95 dengan penjadwalan ulang konten di atas garis lipat.",
        confidence: 0.78,
      });
      return;
    }

    if (metric.inpP95 >= 250) {
      recommendations.set(metric.route, {
        route: metric.route,
        suggestion: "Kurangi JavaScript interaktif berat dan gunakan memoization pada handler input.",
        impact: "Mengurangi INP p95 dengan meminimalkan blocking JS.",
        confidence: 0.74,
      });
      return;
    }

    if (metric.apiLatencyP95 >= 800) {
      recommendations.set(metric.route, {
        route: metric.route,
        suggestion: "Tambahkan caching sisi klien dan prefetch data API menggunakan SWR saat idle.",
        impact: "Mempercepat permintaan API lambat dan menjaga respons navigasi.",
        confidence: 0.72,
      });
      return;
    }

    if (metric.errorRate >= 0.05) {
      recommendations.set(metric.route, {
        route: metric.route,
        suggestion: "Tambahkan fallback UI ringan dan retry otomatis untuk request rapuh.",
        impact: "Menstabilkan pengalaman pengguna tanpa menyentuh domain kritikal.",
        confidence: 0.71,
      });
    }
  });

  return Array.from(recommendations.values());
};

export const generateOptimizationRecommendations = async (
  metrics: ObservabilityMetric[],
  { model = DEFAULT_MODEL }: { model?: string } = {},
): Promise<OptimizationRecommendation[]> => {
  const parsedMetrics = metrics.map((metric) => observabilityMetricSchema.parse(metric));

  if (!parsedMetrics.length) return [];

  const client = createClient();

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Anda adalah arsitek optimasi performa. Kembalikan JSON dengan format {\"recommendations\": [{\"route\",\"suggestion\",\"impact\",\"confidence\"}]}. Confidence minimal 0.7 dan batasi pada UI non-kritis.",
        },
        {
          role: "user",
          content: `Observability metrics (p95): ${JSON.stringify(parsedMetrics)}`,
        },
      ],
    });

    const content = response?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI response missing content");
    }

    const parsedJson = extractJsonFromMessage(content);
    const parsedRecommendations = recommendationResponseSchema.parse(parsedJson).recommendations;

    const filtered = parsedRecommendations.filter((recommendation) => isNonCriticalRoute(recommendation.route));
    return await applyConfidenceRecalibration(filtered);
  } catch (error) {
    console.warn("AI optimizer fallback triggered", error);
    return await applyConfidenceRecalibration(buildFallbackRecommendations(parsedMetrics));
  }
};

const toLogEntry = (log: {
  id: string;
  route: string;
  change: string;
  impact: string;
  confidence: number;
  status: OptimizationStatus;
  actor: string;
  notes: string | null;
  rollback: boolean;
  deltaImpact: number | null;
  evalConfidence: number | null;
  policyStatus: PolicyStatus;
  policyReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OptimizationLogEntry => ({
  id: log.id,
  route: log.route,
  suggestion: log.change,
  impact: log.impact,
  confidence: log.confidence,
  status: log.status,
  actor: log.actor,
  notes: log.notes,
  rollback: log.rollback,
  deltaImpact: log.deltaImpact ?? 0,
  evalConfidence: log.evalConfidence ?? log.confidence,
  policyStatus: log.policyStatus,
  policyReason: log.policyReason ?? undefined,
  createdAt: log.createdAt,
  updatedAt: log.updatedAt,
});

export type OptimizationLogEntry = OptimizationRecommendation & {
  id: string;
  status: OptimizationStatus;
  actor: string;
  notes: string | null;
  rollback: boolean;
  deltaImpact: number;
  evalConfidence: number;
  policyStatus: PolicyStatus;
  policyReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export const saveRecommendations = async (
  recommendations: OptimizationRecommendation[],
  { actor = "system" }: { actor?: string } = {},
): Promise<OptimizationLogEntry[]> => {
  if (!recommendations.length) return [];

  const governanceEnabled = isGovernanceEnabled();

  const created = await Promise.all(
    recommendations.map(async (recommendation) => {
      const normalizedRoute = ensureRouteFormat(recommendation.route);
      const baseData = {
        route: normalizedRoute,
        change: recommendation.suggestion,
        impact: recommendation.impact,
        confidence: recommendation.confidence,
        actor,
        status: OptimizationStatus.PENDING,
      };

      if (!governanceEnabled && !isNonCriticalRoute(normalizedRoute)) {
        // Skip storing when governance is off and the route is critical.
        return null;
      }

      let policyStatus: PolicyStatus = PolicyStatus.ALLOWED;
      let policyReason: string | null = null;

      if (governanceEnabled) {
        const evaluation = evaluatePolicy({
          route: normalizedRoute,
          confidence: recommendation.confidence,
          action: "modify",
        });
        policyStatus = evaluation.status;
        policyReason = evaluation.reasons.length ? evaluation.reasons.join(" | ") : null;
        await notifyPolicyViolation({ ...evaluation, route: normalizedRoute });
      }

      const log = await db.optimizationLog.create({
        data: {
          ...baseData,
          policyStatus,
          policyReason,
        },
      });

      return log;
    }),
  );

  const filtered = created.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return filtered.map(toLogEntry);
};

export const getLatestRecommendations = async ({ limit = 10 } = {}): Promise<OptimizationLogEntry[]> => {
  const logs = await db.optimizationLog.findMany({
    where: { status: OptimizationStatus.PENDING },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return logs.map(toLogEntry);
};

export const getOptimizationHistory = async ({ limit = 50 } = {}): Promise<OptimizationLogEntry[]> => {
  const logs = await db.optimizationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return logs.map(toLogEntry);
};

export const updateOptimizationStatus = async (
  id: string,
  status: OptimizationStatus,
  {
    actor = "system",
    notes,
  }: {
    actor?: string;
    notes?: string;
  } = {},
): Promise<OptimizationLogEntry> => {
  const existing = await db.optimizationLog.findUnique({ where: { id } });

  if (!existing) {
    throw new Error("Rekomendasi tidak ditemukan");
  }

  let policyStatus = existing.policyStatus;
  let policyReason = existing.policyReason;

  if (isGovernanceEnabled() && status === OptimizationStatus.APPLIED) {
    const evaluation = evaluatePolicy({
      route: existing.route,
      confidence: existing.confidence,
      action: "auto-apply",
    });

    if (!evaluation.allowAutoApply || evaluation.status === PolicyStatus.BLOCKED) {
      await notifyPolicyViolation({ ...evaluation, route: existing.route });
      const message =
        evaluation.reasons.join(" | ") || "Rekomendasi ditolak karena melanggar kebijakan governance";
      throw new Error(message);
    }

    policyStatus = evaluation.status;
    policyReason = evaluation.reasons.length ? evaluation.reasons.join(" | ") : null;
  }

  const updated = await db.optimizationLog.update({
    where: { id },
    data: {
      status,
      actor,
      notes: notes ?? null,
      policyStatus,
      policyReason,
    },
  });

  return toLogEntry(updated);
};

export const fetchAndStoreRecommendations = async ({
  intervalMinutes = 60,
  actor = "system",
}: {
  intervalMinutes?: number;
  actor?: string;
} = {}) => {
  const metrics = await fetchMetrics({ intervalMinutes });
  const recommendations = await generateOptimizationRecommendations(metrics);
  return saveRecommendations(recommendations, { actor });
};

export const guardrails = {
  isNonCriticalRoute,
};
