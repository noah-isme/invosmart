import { z } from "zod";

import { agentRoleSchema, type AgentRole } from "@/lib/ai/protocol";

export const federationEventTypeSchema = z.enum([
  "telemetry_sync",
  "priority_share",
  "trust_aggregate",
  "model_update",
]);

export type FederationEventType = z.infer<typeof federationEventTypeSchema>;

const tenantIdSchema = z.string().min(1, "tenantId wajib diisi");

export const prioritySnapshotSchema = z.object({
  agent: agentRoleSchema,
  weight: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

export type PrioritySnapshot = z.infer<typeof prioritySnapshotSchema>;

export const telemetrySyncPayloadSchema = z.object({
  tenantId: tenantIdSchema,
  trustScore: z.number().min(0).max(100),
  trustMetrics: z
    .object({
      successRate: z.number().min(0).max(1),
      rollbackRate: z.number().min(0).max(1),
      policyViolationRate: z.number().min(0).max(1),
      totalRecommendations: z.number().int().min(0),
    })
    .optional(),
  syncLatencyMs: z.number().min(0).optional(),
  priorities: z.array(prioritySnapshotSchema).default([]),
  insightSummary: z.string().optional(),
  sanitized: z.boolean().default(true),
});

export type TelemetrySyncPayload = z.infer<typeof telemetrySyncPayloadSchema>;

export const prioritySharePayloadSchema = z.object({
  tenantId: tenantIdSchema,
  cycleId: z.string().min(1),
  priorities: z.array(prioritySnapshotSchema).min(1),
  rationale: z.string().optional(),
});

export type PrioritySharePayload = z.infer<typeof prioritySharePayloadSchema>;

export const trustAggregatePayloadSchema = z.object({
  tenantId: tenantIdSchema,
  cycleId: z.string().min(1),
  participants: z.number().int().min(1),
  averageTrust: z.number().min(0).max(100),
  highestTrust: z
    .object({ tenantId: tenantIdSchema, trustScore: z.number().min(0).max(100) })
    .nullable()
    .default(null),
  lowestTrust: z
    .object({ tenantId: tenantIdSchema, trustScore: z.number().min(0).max(100) })
    .nullable()
    .default(null),
  networkHealth: z.enum(["healthy", "degraded", "critical"]),
  averageLatencyMs: z.number().min(0).optional(),
  aggregatedPriorities: z.array(prioritySnapshotSchema).default([]),
  summary: z.string().optional(),
});

export type TrustAggregatePayload = z.infer<typeof trustAggregatePayloadSchema>;

export const modelUpdatePayloadSchema = z.object({
  tenantId: tenantIdSchema,
  cycleId: z.string().min(1),
  priorities: z.array(prioritySnapshotSchema).default([]),
  trustScore: z.number().min(0).max(100),
  appliedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export type ModelUpdatePayload = z.infer<typeof modelUpdatePayloadSchema>;

const payloadMap: Record<FederationEventType, z.ZodTypeAny> = {
  telemetry_sync: telemetrySyncPayloadSchema,
  priority_share: prioritySharePayloadSchema,
  trust_aggregate: trustAggregatePayloadSchema,
  model_update: modelUpdatePayloadSchema,
};

export const federationEventSchema = z.object({
  id: z.string().min(1),
  type: federationEventTypeSchema,
  tenantId: tenantIdSchema,
  timestamp: z.string().datetime(),
  signature: z.string().min(10),
  payload: z.union([
    telemetrySyncPayloadSchema,
    prioritySharePayloadSchema,
    trustAggregatePayloadSchema,
    modelUpdatePayloadSchema,
  ]),
});

export type FederationEvent<TType extends FederationEventType = FederationEventType> = z.infer<
  typeof federationEventSchema
> & {
  type: TType;
  payload: TType extends "telemetry_sync"
    ? TelemetrySyncPayload
    : TType extends "priority_share"
      ? PrioritySharePayload
      : TType extends "trust_aggregate"
        ? TrustAggregatePayload
        : ModelUpdatePayload;
};

export type FederationEventInput<TType extends FederationEventType = FederationEventType> = {
  type: TType;
  tenantId?: string;
  timestamp?: string;
  payload: FederationEvent<TType>["payload"];
};

export type FederationEndpointStatus = {
  endpoint: string;
  healthy: boolean;
  lastAttempt?: string;
  lastLatencyMs?: number;
  error?: string;
};

export const sanitizeMetadata = <T extends Record<string, unknown>>(payload: T): T => {
  const clone: Record<string, unknown> = {};
  const forbiddenKeys = new Set([
    "rawEvents",
    "pii",
    "secrets",
    "authToken",
    "accessToken",
    "session",
  ]);

  for (const [key, value] of Object.entries(payload)) {
    if (forbiddenKeys.has(key)) {
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      clone[key] = sanitizeMetadata(value as Record<string, unknown>);
    } else {
      clone[key] = value;
    }
  }

  return clone as T;
};

export const isPayloadOfType = <TType extends FederationEventType>(
  event: FederationEvent,
  type: TType,
): event is FederationEvent<TType> => event.type === type;

export type PreparedFederationEvent<TType extends FederationEventType = FederationEventType> = {
  type: TType;
  tenantId: string;
  timestamp: string;
  payload: FederationEvent<TType>["payload"];
};

export const validateFederationEvent = <TType extends FederationEventType>(
  input: FederationEventInput<TType>,
): PreparedFederationEvent<TType> => {
  const schema = payloadMap[input.type];
  const payload = schema.parse(sanitizeMetadata(input.payload));
  const tenantId = input.tenantId ?? payload.tenantId;
  const timestamp = input.timestamp ?? new Date().toISOString();

  return {
    type: input.type,
    tenantId,
    timestamp,
    payload: payload as FederationEvent<TType>["payload"],
  } satisfies PreparedFederationEvent<TType>;
};

export type AggregatedPriority = {
  agent: AgentRole;
  weight: number;
  confidence: number;
  rationale: string;
};

export type FederationSnapshot = {
  tenantId: string;
  trustScore: number;
  syncLatencyMs?: number;
  priorities: AggregatedPriority[];
  updatedAt: string;
};

export const deriveAggregatedPriorities = (
  snapshots: FederationSnapshot[],
): AggregatedPriority[] => {
  if (!snapshots.length) return [];

  const accumulator = new Map<AgentRole, { weight: number; confidence: number; count: number }>();

  for (const snapshot of snapshots) {
    for (const priority of snapshot.priorities) {
      const current = accumulator.get(priority.agent) ?? { weight: 0, confidence: 0, count: 0 };
      current.weight += priority.weight;
      current.confidence += priority.confidence;
      current.count += 1;
      accumulator.set(priority.agent, current);
    }
  }

  return Array.from(accumulator.entries()).map(([agent, stats]) => {
    const weight = Number((stats.weight / stats.count).toFixed(4));
    const confidence = Number((stats.confidence / stats.count).toFixed(4));
    return {
      agent,
      weight,
      confidence,
      rationale: `Bobot federasi rata-rata ${(weight * 100).toFixed(1)}% (c=${confidence.toFixed(2)})`,
    } satisfies AggregatedPriority;
  });
};

export const aggregateTrustScores = (snapshots: FederationSnapshot[]) => {
  if (!snapshots.length) {
    return {
      averageTrust: 0,
      highest: null,
      lowest: null,
      median: 0,
      stdDeviation: 0,
    } as const;
  }

  const trustValues = snapshots.map((snapshot) => snapshot.trustScore).sort((a, b) => a - b);
  const total = trustValues.reduce((sum, value) => sum + value, 0);
  const averageTrust = total / trustValues.length;
  const highest = snapshots.reduce((acc, snapshot) => (snapshot.trustScore > (acc?.trustScore ?? -Infinity) ? snapshot : acc), null as
    | FederationSnapshot
    | null);
  const lowest = snapshots.reduce((acc, snapshot) => (snapshot.trustScore < (acc?.trustScore ?? Infinity) ? snapshot : acc), null as
    | FederationSnapshot
    | null);
  const middle = Math.floor(trustValues.length / 2);
  const median =
    trustValues.length % 2 === 0
      ? (trustValues[middle - 1] + trustValues[middle]) / 2
      : trustValues[middle];

  const variance =
    trustValues.reduce((sum, value) => sum + (value - averageTrust) ** 2, 0) / trustValues.length;
  const stdDeviation = Math.sqrt(variance);

  return {
    averageTrust,
    highest: highest ? { tenantId: highest.tenantId, trustScore: highest.trustScore } : null,
    lowest: lowest ? { tenantId: lowest.tenantId, trustScore: lowest.trustScore } : null,
    median,
    stdDeviation,
  } as const;
};
