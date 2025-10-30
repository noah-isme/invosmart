import { OptimizationStatus, PolicyStatus } from "@prisma/client";

import { db } from "@/lib/db";

export type TrustScoreMetrics = {
  successRate: number;
  rollbackRate: number;
  policyViolationRate: number;
  totalRecommendations: number;
  applied: number;
  violations: number;
};

export type TrustScore = {
  score: number;
  metrics: TrustScoreMetrics;
};

export const calculateTrustScore = ({
  successRate,
  rollbackRate,
  policyViolationRate,
}: {
  successRate: number;
  rollbackRate: number;
  policyViolationRate: number;
}): number => {
  const normalizedSuccess = Math.max(0, Math.min(1, successRate));
  const normalizedRollback = 1 - Math.max(0, Math.min(1, rollbackRate));
  const normalizedPolicy = 1 - Math.max(0, Math.min(1, policyViolationRate));

  const weighted = normalizedSuccess * 0.5 + normalizedRollback * 0.3 + normalizedPolicy * 0.2;
  return Math.round(weighted * 100);
};

export const getTrustMetrics = async (): Promise<TrustScoreMetrics> => {
  const [total, applied, rollback, violations] = await Promise.all([
    db.optimizationLog.count(),
    db.optimizationLog.count({ where: { status: OptimizationStatus.APPLIED } }),
    db.optimizationLog.count({ where: { rollback: true } }),
    db.optimizationLog.count({
      where: {
        policyStatus: { in: [PolicyStatus.BLOCKED, PolicyStatus.REVIEW] },
      },
    }),
  ]);

  const successRate = total > 0 ? applied / total : 1;
  const rollbackRate = applied > 0 ? rollback / applied : 0;
  const policyViolationRate = total > 0 ? violations / total : 0;

  return {
    successRate,
    rollbackRate,
    policyViolationRate,
    totalRecommendations: total,
    applied,
    violations,
  };
};

export const getTrustScore = async (): Promise<TrustScore> => {
  const metrics = await getTrustMetrics();
  const score = calculateTrustScore(metrics);
  return { score, metrics };
};
