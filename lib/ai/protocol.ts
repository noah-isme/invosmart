import { z } from "zod";

export const agentRoleSchema = z.enum(["optimizer", "learning", "governance", "insight", "federation"]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const mapEventTypeSchema = z.enum([
  "recommendation",
  "evaluation",
  "policy_update",
  "insight_report",
]);
export type MapEventType = z.infer<typeof mapEventTypeSchema>;

export const governancePriority = 90;
export const optimizerPriority = 75;
export const learningPriority = 60;
export const insightPriority = 45;

export const federationPriority = 35;

export const agentPriority: Record<AgentRole, number> = {
  governance: governancePriority,
  optimizer: optimizerPriority,
  learning: learningPriority,
  insight: insightPriority,
  federation: federationPriority,
};

const basePayloadSchema = z.object({
  summary: z.string().min(1, "Ringkasan event wajib diisi"),
  context: z.record(z.any()).optional(),
});

const recommendationPayloadSchema = basePayloadSchema.extend({
  recommendationId: z.string().min(1),
  route: z.string().min(1),
  confidence: z.number().min(0).max(1),
  impact: z.string().min(1),
  metrics: z
    .object({
      lcpP95: z.number().nonnegative().optional(),
      inpP95: z.number().nonnegative().optional(),
      apiLatencyP95: z.number().nonnegative().optional(),
      errorRate: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

const evaluationPayloadSchema = basePayloadSchema.extend({
  recommendationId: z.string().min(1),
  status: z.enum(["approved", "needs_review", "rejected"]),
  compositeImpact: z.number(),
  rollbackTriggered: z.boolean(),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
  metrics: z
    .object({
      deltaLcp: z.number().optional(),
      deltaInp: z.number().optional(),
      deltaLatency: z.number().optional(),
      deltaErrorRate: z.number().optional(),
    })
    .optional(),
});

const policyPayloadSchema = basePayloadSchema.extend({
  recommendationId: z.string().optional(),
  route: z.string().min(1),
  status: z.enum(["ALLOWED", "REVIEW", "BLOCKED"]),
  minimumConfidence: z.number().min(0).max(1),
  allowAutoApply: z.boolean(),
  trustScore: z.number().min(0).max(100),
  trustMetrics: z
    .object({
      successRate: z.number().min(0).max(1),
      rollbackRate: z.number().min(0).max(1),
      policyViolationRate: z.number().min(0).max(1),
    })
    .optional(),
});

const insightPayloadSchema = basePayloadSchema.extend({
  correlations: z
    .array(
      z.object({
        route: z.string(),
        compositeImpact: z.number(),
        confidenceShift: z.number(),
        rollbackTriggered: z.boolean(),
      }),
    )
    .default([]),
  month: z.string().optional(),
});

const baseEventSchema = z.object({
  traceId: z.string().min(1),
  type: mapEventTypeSchema,
  source: agentRoleSchema,
  target: agentRoleSchema.optional(),
  priority: z.number().int().min(1).max(100).default(50),
  timestamp: z.string().datetime(),
});

export const mapEventSchema = z.discriminatedUnion("type", [
  baseEventSchema.extend({
    type: z.literal("recommendation"),
    payload: recommendationPayloadSchema,
  }),
  baseEventSchema.extend({
    type: z.literal("evaluation"),
    payload: evaluationPayloadSchema,
  }),
  baseEventSchema.extend({
    type: z.literal("policy_update"),
    payload: policyPayloadSchema,
  }),
  baseEventSchema.extend({
    type: z.literal("insight_report"),
    payload: insightPayloadSchema,
  }),
]);

export type MapEvent = z.infer<typeof mapEventSchema>;

export type MapEventInput = Omit<MapEvent, "traceId" | "timestamp" | "priority"> & {
  traceId?: string;
  timestamp?: string;
  priority?: number;
};

export type AgentRegistrationInput = {
  agentId: AgentRole;
  name: string;
  description?: string;
  capabilities?: string[];
  priorityOverride?: number;
};

export type AgentRegistration = {
  agentId: AgentRole;
  name: string;
  description?: string;
  capabilities: string[];
  priority: number;
  streamKey: string;
  registeredAt: string;
};

export const createEventTimestamp = () => new Date().toISOString();

export const ensurePriority = (agent: AgentRole, override?: number) => {
  if (typeof override === "number") {
    return Math.max(1, Math.min(100, Math.round(override)));
  }
  return agentPriority[agent];
};

export const sortEventsByGovernance = (events: MapEvent[]): MapEvent[] => {
  return [...events].sort((a, b) => {
    const priorityDiff = (agentPriority[b.source] ?? 0) - (agentPriority[a.source] ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
};

export const AGENT_NAMES: Record<AgentRole, string> = {
  optimizer: "OptimizerAgent",
  learning: "LearningAgent",
  governance: "GovernanceAgent",
  insight: "InsightAgent",
  federation: "FederationAgent",
};

export const EVENT_STREAM_KEY = "ai:orchestrator:events" as const;
