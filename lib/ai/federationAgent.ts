import { dispatchEvent, isOrchestrationEnabled, registerAgent } from "@/lib/ai/orchestrator";
import { getStoredPriorities } from "@/lib/ai/priority";
import { type PrioritySnapshot } from "@/lib/federation/protocol";
import {
  type FederationSnapshot,
  type TelemetrySyncPayload,
  type PrioritySharePayload,
  type TrustAggregatePayload,
  type ModelUpdatePayload,
  deriveAggregatedPriorities,
} from "@/lib/federation/protocol";
import { federationBus, type FederationBus } from "@/lib/federation/bus";
import { getTrustScore } from "@/lib/ai/trustScore";
import {
  analyzeGlobalFederation,
  recordFederationMetrics,
  type GlobalFederationInsight,
} from "@/lib/ai/globalInsight";

const MAX_HISTORY = 100;

export type FederationAgentOptions = {
  bus?: FederationBus;
  tenantId?: string;
  dependencies?: Partial<Dependencies>;
};

type Dependencies = {
  bus: FederationBus;
  fetchTrustScore: typeof getTrustScore;
  fetchPriorities: typeof getStoredPriorities;
  persistMetrics: typeof recordFederationMetrics;
};

type SnapshotStore = Map<string, FederationSnapshot>;

export type TrustAggregateState = TrustAggregatePayload & { receivedAt: string };

export type ModelUpdateState = ModelUpdatePayload & { receivedAt: string };

const defaultDeps = (): Dependencies => ({
  bus: federationBus,
  fetchTrustScore: getTrustScore,
  fetchPriorities: getStoredPriorities,
  persistMetrics: recordFederationMetrics,
});

const toSnapshot = (payload: TelemetrySyncPayload | PrioritySharePayload): FederationSnapshot => ({
  tenantId: payload.tenantId,
  trustScore: "trustScore" in payload ? payload.trustScore : 0,
  syncLatencyMs: "syncLatencyMs" in payload ? payload.syncLatencyMs : undefined,
  priorities: payload.priorities.map((priority) => ({
    agent: priority.agent,
    weight: priority.weight,
    confidence: priority.confidence,
    rationale: priority.rationale,
  })),
  updatedAt: new Date().toISOString(),
});

const toPrioritySnapshot = (priority: PrioritySnapshot) => ({
  agent: priority.agent,
  weight: Number(priority.weight.toFixed(4)),
  confidence: Number(priority.confidence.toFixed(4)),
  rationale: priority.rationale,
});

export class FederationAgent {
  private readonly deps: Dependencies;
  private readonly snapshots: SnapshotStore = new Map();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly history: TrustAggregateState[] = [];
  private modelHistory: ModelUpdateState[] = [];
  private lastInsight: GlobalFederationInsight | null = null;
  private readonly tenantId: string;

  constructor(options?: FederationAgentOptions) {
    this.deps = { ...defaultDeps(), ...(options?.dependencies ?? {}) };
    if (options?.bus) {
      this.deps.bus = options.bus;
    }
    this.tenantId = options?.tenantId ?? this.deps.bus.getTenantId();

    if (!this.deps.bus.isEnabled) {
      return;
    }

    if (isOrchestrationEnabled()) {
      registerAgent({
        agentId: "federation",
        name: "FederationAgent",
        description: "Mengkoordinasikan federated learning dan trust lintas instance.",
        capabilities: ["federated-learning", "trust-aggregation", "global-insight"],
        priorityOverride: 40,
      });
    }

    this.unsubscribers.push(
      this.deps.bus.subscribe("telemetry_sync", (event) => this.handleTelemetry(event.payload, event.timestamp)),
      this.deps.bus.subscribe("priority_share", (event) => this.handlePriorityShare(event.payload, event.timestamp)),
      this.deps.bus.subscribe("trust_aggregate", (event) => this.handleTrustAggregate(event.payload, event.timestamp)),
      this.deps.bus.subscribe("model_update", (event) => this.handleModelUpdate(event.payload, event.timestamp)),
    );
  }

  dispose() {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
  }

  private upsertSnapshot(snapshot: FederationSnapshot) {
    const previous = this.snapshots.get(snapshot.tenantId);
    const merged: FederationSnapshot = previous
      ? {
          tenantId: snapshot.tenantId,
          trustScore: snapshot.trustScore || previous.trustScore,
          syncLatencyMs: snapshot.syncLatencyMs ?? previous.syncLatencyMs,
          priorities: snapshot.priorities.length ? snapshot.priorities : previous.priorities,
          updatedAt: snapshot.updatedAt,
        }
      : snapshot;

    this.snapshots.set(snapshot.tenantId, merged);
  }

  private async handleTelemetry(payload: TelemetrySyncPayload, timestamp: string) {
    this.upsertSnapshot({
      tenantId: payload.tenantId,
      trustScore: payload.trustScore,
      syncLatencyMs: payload.syncLatencyMs,
      priorities: payload.priorities.map(toPrioritySnapshot),
      updatedAt: timestamp,
    });

    if (payload.tenantId !== this.tenantId) {
      await this.evaluateGlobalNetwork("telemetry");
    }
  }

  private async handlePriorityShare(payload: PrioritySharePayload, timestamp: string) {
    this.upsertSnapshot({
      tenantId: payload.tenantId,
      trustScore: this.snapshots.get(payload.tenantId)?.trustScore ?? 0,
      priorities: payload.priorities.map(toPrioritySnapshot),
      updatedAt: timestamp,
    });

    if (payload.tenantId !== this.tenantId) {
      await this.evaluateGlobalNetwork("priority");
    }
  }

  private async handleTrustAggregate(payload: TrustAggregatePayload, timestamp: string) {
    const aggregate: TrustAggregateState = { ...payload, receivedAt: timestamp };
    this.history.unshift(aggregate);
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
    this.lastInsight = analyzeGlobalFederation([...this.snapshots.values()]);
  }

  private handleModelUpdate(payload: ModelUpdatePayload, timestamp: string) {
    const entry: ModelUpdateState = { ...payload, receivedAt: timestamp };
    this.modelHistory.unshift(entry);
    if (this.modelHistory.length > MAX_HISTORY) {
      this.modelHistory.length = MAX_HISTORY;
    }
  }

  getSnapshots() {
    return Array.from(this.snapshots.values());
  }

  getTrustHistory() {
    return [...this.history];
  }

  getModelHistory() {
    return [...this.modelHistory];
  }

  getLatestInsight() {
    return this.lastInsight;
  }

  async broadcastLocalSnapshot() {
    if (!this.deps.bus.isEnabled) return null;

    const [trust, priorities] = await Promise.all([
      this.deps.fetchTrustScore(),
      this.deps.fetchPriorities(),
    ]);

    const sanitizedPriorities = priorities.map((priority) => ({
      agent: priority.agent,
      weight: Number(priority.weight.toFixed(4)),
      confidence: Number(priority.confidence.toFixed(4)),
      rationale: priority.rationale,
    }));

    const payload: TelemetrySyncPayload = {
      tenantId: this.tenantId,
      trustScore: trust.score,
      trustMetrics: trust.metrics,
      priorities: sanitizedPriorities,
      sanitized: true,
    };

    this.upsertSnapshot(toSnapshot(payload));

    const result = await this.deps.bus.publish({ type: "telemetry_sync", payload });

    await this.evaluateGlobalNetwork("local-snapshot");

    return result;
  }

  private async evaluateGlobalNetwork(reason: string) {
    const snapshots = [...this.snapshots.values()].filter((snapshot) => snapshot.trustScore > 0 || snapshot.priorities.length);
    if (!snapshots.length) return;

    const aggregatedPriorities = deriveAggregatedPriorities(snapshots);
    const averageLatency = snapshots.length
      ? snapshots.reduce((sum, snapshot) => sum + (snapshot.syncLatencyMs ?? 0), 0) / snapshots.length
      : undefined;

    const cycleId = `${new Date().toISOString()}::${reason}`;

    const insight = await this.deps.persistMetrics({
      cycleId,
      tenantId: this.tenantId,
      snapshots,
      aggregatedPriorities,
      averageLatencyMs: averageLatency,
    });

    this.lastInsight = insight;

    const trustPayload: TrustAggregatePayload = {
      tenantId: this.tenantId,
      cycleId,
      participants: snapshots.length,
      averageTrust: insight.averageTrust,
      highestTrust: insight.highestTenant ?? null,
      lowestTrust: insight.lowestTenant ?? null,
      networkHealth: insight.networkHealth,
      averageLatencyMs: insight.averageLatencyMs,
      aggregatedPriorities,
      summary: insight.summary,
    };

    this.history.unshift({ ...trustPayload, receivedAt: new Date().toISOString() });
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }

    await this.deps.bus.publish({ type: "trust_aggregate", payload: trustPayload });

    const priorityPayload: PrioritySharePayload = {
      tenantId: this.tenantId,
      cycleId,
      priorities: aggregatedPriorities.map((priority) => ({
        ...priority,
        rationale: `Rata-rata global ${(priority.weight * 100).toFixed(1)}%`,
      })),
      rationale: insight.summary,
    };

    await this.deps.bus.publish({ type: "priority_share", payload: priorityPayload });

    const modelPayload: ModelUpdatePayload = {
      tenantId: this.tenantId,
      cycleId,
      priorities: aggregatedPriorities,
      trustScore: insight.averageTrust,
      appliedAt: new Date().toISOString(),
      notes: `Sinkronisasi global (${reason})`,
    };

    this.modelHistory.unshift({ ...modelPayload, receivedAt: new Date().toISOString() });
    if (this.modelHistory.length > MAX_HISTORY) {
      this.modelHistory.length = MAX_HISTORY;
    }

    await this.deps.bus.publish({ type: "model_update", payload: modelPayload });

    if (isOrchestrationEnabled()) {
      const correlations = aggregatedPriorities.map((priority) => ({
        route: priority.agent,
        compositeImpact: Number((priority.weight * 100 - 50).toFixed(2)),
        confidenceShift: Number((priority.confidence - 0.5).toFixed(2)),
        rollbackTriggered: false,
      }));

      await dispatchEvent({
        type: "insight_report",
        source: "federation",
        target: "insight",
        payload: {
          summary: `FederationAgent menyinkronkan ${snapshots.length} instance (health: ${insight.networkHealth}).`,
          correlations,
          context: {
            cycleId,
            reason,
            networkHealth: insight.networkHealth,
            averageTrust: insight.averageTrust,
          },
        },
      });
    }
  }
}

let federationAgentSingleton: FederationAgent | null = null;

export const getFederationAgent = () => {
  if (!federationAgentSingleton) {
    federationAgentSingleton = new FederationAgent();
  }
  return federationAgentSingleton;
};

if (process.env.ENABLE_AI_FEDERATION !== "false") {
  getFederationAgent();
}
