import { PolicyStatus } from "@prisma/client";
import { z } from "zod";

import { DEFAULT_MODEL, createClient } from "@/lib/ai";
import { db } from "@/lib/db";
import { evaluatePolicy, isGovernanceEnabled } from "@/lib/ai/policy";
import { getTrustScore } from "@/lib/ai/trustScore";

const ExplanationResponseSchema = z.object({
  why: z.string().min(1),
  context: z.string().optional().nullable(),
  data_basis: z.union([
    z.array(z.string().min(1)),
    z.string().min(1),
    z.record(z.string(), z.any()),
  ]),
  confidence: z.number().min(0).max(1),
});

export type ExplanationPayload = {
  id: string;
  recommendationId: string;
  route: string;
  why: string;
  context: string | null;
  dataBasis: string[];
  confidence: number;
  policyStatus: PolicyStatus;
  trustScore: number;
  createdAt: Date;
};

const MODEL = DEFAULT_MODEL;

const normalizeDataBasis = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${JSON.stringify(entry)}`)
      .slice(0, 6);
  }

  if (typeof value === "string") {
    return value.split(/\n|\./).map((part) => part.trim()).filter(Boolean).slice(0, 6);
  }

  return [];
};

const buildPrompt = (log: { route: string; change: string; impact: string; confidence: number; policyStatus: PolicyStatus }) => {
  const base = {
    route: log.route,
    suggestion: log.change,
    impact: log.impact,
    confidence: log.confidence,
    policyStatus: log.policyStatus,
  };

  const formatted = JSON.stringify(base, null, 2);

  return `Anda adalah AI governance explainer untuk platform optimasi UI. Jelaskan alasan rekomendasi berikut secara ringkas dan dapat diaudit.
${formatted}

Balasan dalam format JSON:
{
  "why": "alasan utama",
  "context": "konteks tambahan",
  "data_basis": ["sumber data"],
  "confidence": 0.0 sampai 1.0
}`;
};

const buildFallbackExplanation = (log: { route: string; change: string; impact: string; confidence: number; policyStatus: PolicyStatus }) => {
  const why = `Perubahan pada ${log.route} ditujukan untuk ${log.impact.toLowerCase()}.`; // fallback reason
  const context = `Rekomendasi memiliki confidence ${Math.round(log.confidence * 100)}% dan status kebijakan ${log.policyStatus}.`;
  const dataBasis = normalizeDataBasis([log.change, log.impact]);
  const confidence = Math.min(0.98, Math.max(0.5, log.confidence));
  return { why, context, dataBasis, confidence };
};

export const generateExplanationForRecommendation = async (
  recommendationId: string,
  actor: string,
): Promise<ExplanationPayload> => {
  const recommendation = await db.optimizationLog.findUnique({ where: { id: recommendationId } });
  if (!recommendation) {
    throw new Error("Rekomendasi tidak ditemukan");
  }

  const trust = await getTrustScore();

  const evaluation = isGovernanceEnabled()
    ? evaluatePolicy({ route: recommendation.route, confidence: recommendation.confidence, action: "modify" })
    : { status: PolicyStatus.ALLOWED, reasons: [], minimumConfidence: 0.7, allowAutoApply: true, category: "UI" };

  let payload: z.infer<typeof ExplanationResponseSchema> | null = null;
  let errorMessage: string | null = null;

  try {
    const client = createClient();
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "Anda adalah analis governance AI yang menjelaskan rekomendasi dengan bahasa profesional dan dapat diaudit.",
        },
        { role: "user", content: buildPrompt(recommendation) },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const cleaned = content.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || start > end) {
      throw new Error("AI tidak mengembalikan JSON yang valid");
    }

    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    payload = ExplanationResponseSchema.parse(parsed);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const base = payload
    ? {
        why: payload.why,
        context: payload.context ?? null,
        dataBasis: normalizeDataBasis(payload.data_basis),
        confidence: payload.confidence,
      }
    : buildFallbackExplanation(recommendation);

  const record = await db.explanationLog.create({
    data: {
      recommendationId,
      route: recommendation.route,
      why: base.why,
      context: base.context,
      dataBasis: base.dataBasis,
      confidence: base.confidence,
      policyStatus: evaluation.status,
      trustScore: trust.score,
      actor,
      metadata: errorMessage ? { fallback: true, error: errorMessage } : { fallback: false },
    },
  });

  return {
    id: record.id,
    recommendationId: record.recommendationId,
    route: record.route,
    why: record.why,
    context: record.context,
    dataBasis: Array.isArray(record.dataBasis) ? (record.dataBasis as string[]) : normalizeDataBasis(record.dataBasis),
    confidence: record.confidence,
    policyStatus: record.policyStatus,
    trustScore: record.trustScore,
    createdAt: record.createdAt,
  };
};

export const getLatestExplanationForRecommendation = async (
  recommendationId: string,
): Promise<ExplanationPayload | null> => {
  const explanation = await db.explanationLog.findFirst({
    where: { recommendationId },
    orderBy: { createdAt: "desc" },
  });

  if (!explanation) return null;

  return {
    id: explanation.id,
    recommendationId: explanation.recommendationId,
    route: explanation.route,
    why: explanation.why,
    context: explanation.context,
    dataBasis: Array.isArray(explanation.dataBasis)
      ? (explanation.dataBasis as string[])
      : normalizeDataBasis(explanation.dataBasis),
    confidence: explanation.confidence,
    policyStatus: explanation.policyStatus,
    trustScore: explanation.trustScore,
    createdAt: explanation.createdAt,
  };
};

export const getLatestExplanationsMap = async (recommendationIds: string[]) => {
  if (!recommendationIds.length) {
    return new Map<string, ExplanationPayload>();
  }

  const explanations = await db.explanationLog.findMany({
    where: { recommendationId: { in: recommendationIds } },
    orderBy: { createdAt: "desc" },
  });

  const map = new Map<string, ExplanationPayload>();
  for (const explanation of explanations) {
    if (map.has(explanation.recommendationId)) continue;
    map.set(explanation.recommendationId, {
      id: explanation.id,
      recommendationId: explanation.recommendationId,
      route: explanation.route,
      why: explanation.why,
      context: explanation.context,
      dataBasis: Array.isArray(explanation.dataBasis)
        ? (explanation.dataBasis as string[])
        : normalizeDataBasis(explanation.dataBasis),
      confidence: explanation.confidence,
      policyStatus: explanation.policyStatus,
      trustScore: explanation.trustScore,
      createdAt: explanation.createdAt,
    });
  }

  return map;
};
