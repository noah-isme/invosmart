import { db } from "@/lib/db";
import { agentRoleSchema, type AgentRole } from "./protocol";

export type PrioritySignal = {
  successDelta: number;
  load: number;
  trustScore: number;
  errorRate?: number;
  governanceOverride?: number;
};

export type AgentPrioritySnapshot = {
  agent: AgentRole;
  weight: number;
  confidence: number;
  rationale: string;
};

const AGENT_ROLES = agentRoleSchema.options;

const BASE_WEIGHTS: Record<AgentRole, number> = {
  governance: 0.25,
  recovery:   0.20,
  optimizer:  0.22,
  learning:   0.17,
  insight:    0.10,
  federation: 0.06,
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizeWeights = (weights: Record<AgentRole, number>): Record<AgentRole, number> => {
  const total = Object.values(weights).reduce((acc, value) => acc + value, 0);
  if (total === 0) {
    return { ...BASE_WEIGHTS };
  }

  return AGENT_ROLES.reduce((acc, agent) => {
    acc[agent] = weights[agent] / total;
    return acc;
  }, {} as Record<AgentRole, number>);
};

export const calculatePriorityWeights = (signal: PrioritySignal): AgentPrioritySnapshot[] => {
  const governanceBoost = typeof signal.governanceOverride === "number" ? clamp01(signal.governanceOverride) : undefined;
  const trustModifier = clamp01(signal.trustScore / 100);
  const successModifier = clamp01(0.5 + signal.successDelta / 2);
  const loadModifier = clamp01(signal.load);
  const errorPenalty = clamp01(signal.errorRate ?? 0);

  const rawWeights = AGENT_ROLES.reduce((acc, agent) => {
    const base = BASE_WEIGHTS[agent];

    if (agent === "governance" && governanceBoost !== undefined) {
      acc[agent] = governanceBoost;
      return acc;
    }

    const dynamicWeight =
      agent === "optimizer"
        ? base * (0.7 * successModifier + 0.3 * trustModifier)
        : agent === "learning"
          ? base * (0.6 * (1 - successModifier) + 0.4 * trustModifier)
          : agent === "recovery"
            ? base * (0.7 * (1 - errorPenalty) + 0.3 * (1 - trustModifier))
            : agent === "insight"
              ? base * (0.5 * (1 - loadModifier) + 0.5 * trustModifier)
              : agent === "federation"
                ? base * (0.6 * trustModifier + 0.4 * (1 - errorPenalty))
                : base * (0.5 * trustModifier + 0.5 * (1 - errorPenalty));

    acc[agent] = dynamicWeight;
    return acc;
  }, { ...BASE_WEIGHTS } as Record<AgentRole, number>);

  const normalized = normalizeWeights(rawWeights);

  return AGENT_ROLES.map((agent) => {
    const weight = normalized[agent];
    const confidence = clamp01(0.4 + trustModifier * 0.4 + (1 - errorPenalty) * 0.2);
    const rationale =
      agent === "optimizer"
        ? "Optimizer diprioritaskan berdasarkan keberhasilan loop terbaru."
        : agent === "learning"
          ? "LearningAgent diperkuat untuk mengimbangi area yang belum optimal."
          : agent === "governance"
            ? "Governance memastikan kepatuhan saat skor kepercayaan turun."
            : agent === "recovery"
              ? "RecoveryAgent diaktifkan untuk mendeteksi dan memulihkan regresi performa."
              : agent === "insight"
                ? "InsightAgent membantu mendeteksi pola anomali dan peluang baru."
                : "FederationAgent menyelaraskan prioritas lintas instance untuk menjaga konsistensi global.";

    return {
      agent,
      weight,
      confidence,
      rationale,
    } satisfies AgentPrioritySnapshot;
  });
};

export type PersistedPriority = AgentPrioritySnapshot & { id: string; updatedAt: Date };

export const persistPriorities = async (snapshots: AgentPrioritySnapshot[]): Promise<PersistedPriority[]> => {
  const now = new Date();
  const records = await Promise.all(
    snapshots.map((snapshot) =>
      db.agentPriority.upsert({
        where: { agent: snapshot.agent },
        update: {
          weight: snapshot.weight,
          confidence: snapshot.confidence,
          rationale: snapshot.rationale,
          updatedAt: now,
        },
        create: {
          agent: snapshot.agent,
          weight: snapshot.weight,
          confidence: snapshot.confidence,
          rationale: snapshot.rationale,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
  );

  return records.map((record, i) => {
    const snap = snapshots[i];
    return {
      id: record?.id ?? `${snap.agent}-${now.getTime()}`,
      agent: (record?.agent ?? snap.agent) as AgentRole,
      weight: record?.weight ?? snap.weight,
      confidence: record?.confidence ?? snap.confidence,
      rationale: record?.rationale ?? snap.rationale ?? "",
      updatedAt: record?.updatedAt ?? now,
    };
  });
};

export type PriorityUpdateResult = {
  weights: PersistedPriority[];
  summary: string;
};

export const updateAgentPriorities = async (signal: PrioritySignal): Promise<PriorityUpdateResult> => {
  const snapshots = calculatePriorityWeights(signal);
  const saved = await persistPriorities(snapshots);

  const formatted = saved
    .map((entry) => `${entry.agent.toUpperCase()}: ${(entry.weight * 100).toFixed(1)}% (c=${entry.confidence.toFixed(2)})`)
    .join(", ");

  return {
    weights: saved,
    summary: `Prioritas agen diperbarui → ${formatted}`,
  } satisfies PriorityUpdateResult;
};

export const getStoredPriorities = async (): Promise<PersistedPriority[]> => {
  const priorities = await db.agentPriority.findMany({ orderBy: { updatedAt: "desc" } });
  return priorities.map((entry) => ({
    id: entry.id,
    agent: entry.agent as AgentRole,
    weight: entry.weight,
    confidence: entry.confidence,
    rationale: entry.rationale ?? "",
    updatedAt: entry.updatedAt,
  }));
};
