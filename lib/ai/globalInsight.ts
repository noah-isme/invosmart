import { db } from "@/lib/db";
import {
  type AggregatedPriority,
  type FederationSnapshot,
  aggregateTrustScores,
  deriveAggregatedPriorities,
} from "@/lib/federation/protocol";

export type GlobalFederationInsight = {
  averageTrust: number;
  medianTrust: number;
  trustStdDeviation: number;
  participants: number;
  averageLatencyMs?: number;
  highestTenant?: { tenantId: string; trustScore: number } | null;
  lowestTenant?: { tenantId: string; trustScore: number } | null;
  aggregatedPriorities: AggregatedPriority[];
  networkHealth: "healthy" | "degraded" | "critical";
  summary: string;
};

const determineNetworkHealth = (
  averageTrust: number,
  stdDeviation: number,
  participants: number,
): "healthy" | "degraded" | "critical" => {
  if (participants === 0) return "critical";
  if (averageTrust >= 80 && stdDeviation <= 12) return "healthy";
  if (averageTrust >= 60 && stdDeviation <= 20) return "degraded";
  return "critical";
};

export const analyzeGlobalFederation = (snapshots: FederationSnapshot[]): GlobalFederationInsight => {
  const trust = aggregateTrustScores(snapshots);
  const aggregatedPriorities = deriveAggregatedPriorities(snapshots);
  const averageLatency = snapshots.length
    ? snapshots.reduce((sum, snapshot) => sum + (snapshot.syncLatencyMs ?? 0), 0) / snapshots.length
    : undefined;

  const networkHealth = determineNetworkHealth(trust.averageTrust, trust.stdDeviation, snapshots.length);
  const summary =
    snapshots.length === 0
      ? "Belum ada telemetry federasi yang diterima."
      : `Rata-rata trust global ${trust.averageTrust.toFixed(1)} dengan deviasi ${trust.stdDeviation.toFixed(1)}. ` +
        `Prioritas teratas: ${aggregatedPriorities
          .slice(0, 3)
          .map((priority) => `${priority.agent.toUpperCase()} ${(priority.weight * 100).toFixed(1)}%`)
          .join(", ") || "-"}.`;

  return {
    averageTrust: Number(trust.averageTrust.toFixed(2)),
    medianTrust: Number(trust.median.toFixed(2)),
    trustStdDeviation: Number(trust.stdDeviation.toFixed(2)),
    participants: snapshots.length,
    averageLatencyMs: averageLatency ? Number(averageLatency.toFixed(2)) : undefined,
    highestTenant: trust.highest
      ? { tenantId: trust.highest.tenantId, trustScore: trust.highest.trustScore }
      : null,
    lowestTenant: trust.lowest
      ? { tenantId: trust.lowest.tenantId, trustScore: trust.lowest.trustScore }
      : null,
    aggregatedPriorities,
    networkHealth,
    summary,
  } satisfies GlobalFederationInsight;
};

export type RecordFederationMetricsInput = {
  cycleId: string;
  tenantId: string;
  snapshots: FederationSnapshot[];
  aggregatedPriorities?: AggregatedPriority[];
  averageLatencyMs?: number;
  summaryOverride?: string;
};

export const recordFederationMetrics = async (
  input: RecordFederationMetricsInput,
): Promise<GlobalFederationInsight> => {
  const analysis = analyzeGlobalFederation(input.snapshots);
  const aggregatedPriorities = input.aggregatedPriorities ?? analysis.aggregatedPriorities;
  const averageLatencyMs = input.averageLatencyMs ?? analysis.averageLatencyMs;
  const summary = input.summaryOverride ?? analysis.summary;

  await db.federationMetrics.upsert({
    where: {
      cycleId_tenantId: {
        cycleId: input.cycleId,
        tenantId: input.tenantId,
      },
    },
    update: {
      participants: analysis.participants,
      averageTrust: analysis.averageTrust,
      medianTrust: analysis.medianTrust,
      trustStdDeviation: analysis.trustStdDeviation,
      highestTenant: analysis.highestTenant?.tenantId ?? null,
      highestTrust: analysis.highestTenant?.trustScore ?? null,
      lowestTenant: analysis.lowestTenant?.tenantId ?? null,
      lowestTrust: analysis.lowestTenant?.trustScore ?? null,
      averageLatencyMs: averageLatencyMs ?? null,
      aggregatedPriorities,
      summary,
      networkHealth: analysis.networkHealth,
    },
    create: {
      cycleId: input.cycleId,
      tenantId: input.tenantId,
      participants: analysis.participants,
      averageTrust: analysis.averageTrust,
      medianTrust: analysis.medianTrust,
      trustStdDeviation: analysis.trustStdDeviation,
      highestTenant: analysis.highestTenant?.tenantId ?? null,
      highestTrust: analysis.highestTenant?.trustScore ?? null,
      lowestTenant: analysis.lowestTenant?.tenantId ?? null,
      lowestTrust: analysis.lowestTenant?.trustScore ?? null,
      averageLatencyMs: averageLatencyMs ?? null,
      aggregatedPriorities,
      summary,
      networkHealth: analysis.networkHealth,
    },
  });

  return {
    ...analysis,
    aggregatedPriorities,
    averageLatencyMs: averageLatencyMs ?? undefined,
    summary,
  } satisfies GlobalFederationInsight;
};
