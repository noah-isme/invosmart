import { db } from "@/lib/db";
import { type AgentRole, agentRoleSchema } from "./protocol";
import { getTrustScore } from "./trustScore";

export type RecoverySignal = {
  agent?: AgentRole;
  trustScoreBefore: number;
  trustScoreAfter: number;
  errorRate: number;
  regressionThreshold?: number;
  traceId?: string;
};

export type RecoveryAction = {
  agent: AgentRole;
  action: "noop" | "rollback" | "reevaluate";
  reason: string;
  trustScoreBefore: number;
  trustScoreAfter: number;
  traceId?: string;
};

export const RECOVERY_REGRESSION_THRESHOLD = 0.1;

const clampAgent = (agent?: AgentRole): AgentRole => {
  if (agent && agentRoleSchema.safeParse(agent).success) {
    return agent;
  }
  return "optimizer";
};

export const analyzeRecovery = (signal: RecoverySignal): RecoveryAction => {
  const { trustScoreBefore, trustScoreAfter, errorRate } = signal;
  const delta = trustScoreBefore === 0 ? 0 : (trustScoreBefore - trustScoreAfter) / Math.max(trustScoreBefore, 1);
  const threshold = signal.regressionThreshold ?? RECOVERY_REGRESSION_THRESHOLD;

  if (delta >= threshold || errorRate >= 0.15) {
    return {
      agent: clampAgent(signal.agent),
      action: "rollback",
      reason: `Regresi ${(delta * 100).toFixed(1)}% terdeteksi, memicu rollback & re-evaluasi`,
      trustScoreBefore,
      trustScoreAfter,
      traceId: signal.traceId,
    } satisfies RecoveryAction;
  }

  if (delta >= threshold / 2 || errorRate >= 0.08) {
    return {
      agent: clampAgent(signal.agent),
      action: "reevaluate",
      reason: "Tren kualitas menurun, meminta agen belajar ulang.",
      trustScoreBefore,
      trustScoreAfter,
      traceId: signal.traceId,
    } satisfies RecoveryAction;
  }

  return {
    agent: clampAgent(signal.agent),
    action: "noop",
    reason: "Performa stabil, tidak ada tindakan recovery",
    trustScoreBefore,
    trustScoreAfter,
    traceId: signal.traceId,
  } satisfies RecoveryAction;
};

export const persistRecoveryAction = async (action: RecoveryAction) => {
  return db.recoveryLog.create({
    data: {
      agent: action.agent,
      action: action.action,
      reason: action.reason,
      trustScoreBefore: action.trustScoreBefore,
      trustScoreAfter: action.trustScoreAfter,
      traceId: action.traceId ?? null,
    },
  });
};

export type RecoveryResult = RecoveryAction & {
  createdAt: Date;
};

export const runRecoverySweep = async (signal?: Partial<RecoverySignal>): Promise<RecoveryResult> => {
  const trust = await getTrustScore();
  const action = analyzeRecovery({
    agent: signal?.agent,
    trustScoreBefore: trust.score,
    trustScoreAfter: trust.score * (1 - (signal?.errorRate ?? 0)),
    errorRate: signal?.errorRate ?? trust.metrics.policyViolationRate,
    regressionThreshold: signal?.regressionThreshold,
    traceId: signal?.traceId,
  });

  const record = await persistRecoveryAction(action);
  return { ...action, createdAt: record.createdAt } satisfies RecoveryResult;
};

export const listRecoveryLog = async ({ limit = 20 } = {}) => {
  const entries = await db.recoveryLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return entries.map((entry) => ({
    id: entry.id,
    agent: entry.agent as AgentRole,
    action: entry.action,
    reason: entry.reason ?? "",
    createdAt: entry.createdAt,
    trustScoreBefore: entry.trustScoreBefore ?? undefined,
    trustScoreAfter: entry.trustScoreAfter ?? undefined,
    traceId: entry.traceId ?? undefined,
  }));
};
