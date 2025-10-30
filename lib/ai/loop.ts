import { db } from "@/lib/db";
import { dispatchEvent, getOrchestratorSnapshot, isOrchestrationEnabled } from "./orchestrator";
import { type PersistedPriority, type PrioritySignal, updateAgentPriorities } from "./priority";
import { describeScalingDecision, evaluateScaling, sampleBacklogSize, type ScalingDecision, type ScalingState } from "./scaler";
import { listRecoveryLog, runRecoverySweep, type RecoveryResult } from "./recoveryAgent";
import { getTrustScore } from "./trustScore";
import { EVENT_STREAM_KEY } from "./protocol";

export type LoopTelemetry = {
  timestamp: string;
  load: number;
  backlogSize: number;
  trustScore: number;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
};

export type LoopRunResult = {
  enabled: boolean;
  intervalMs: number;
  concurrency: number;
  priorities: PersistedPriority[];
  scaling: ScalingDecision;
  recovery: RecoveryResult;
  telemetry: LoopTelemetry;
  summary: string;
  history: LoopTelemetry[];
};

const MIN_INTERVAL = 60_000;
const MAX_INTERVAL = 15 * 60_000;
const DEFAULT_INTERVAL = 5 * 60_000;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampInterval = (value: number) => Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, value));

const runtimeState: ScalingState & { timer: NodeJS.Timeout | null; history: LoopTelemetry[]; enabled: boolean } = {
  concurrency: 1,
  intervalMs: DEFAULT_INTERVAL,
  timer: null,
  history: [],
  enabled: false,
};

export const adaptiveInterval = (
  metrics: Pick<LoopTelemetry, "load" | "trustScore" | "successRate" | "errorRate">,
  baseInterval = DEFAULT_INTERVAL,
) => {
  const loadFactor = 1 + clamp01(metrics.load) * 0.5;
  const trustFactor = 1 - clamp01(metrics.trustScore / 100) * 0.3;
  const successFactor = 1 - clamp01(metrics.successRate) * 0.25;
  const errorFactor = 1 + clamp01(metrics.errorRate) * 0.6;

  const rawInterval = baseInterval * loadFactor * trustFactor * successFactor * errorFactor;
  return Math.round(clampInterval(rawInterval));
};

export const isAutonomyEnabled = () => process.env.ENABLE_AI_AUTONOMY !== "false";

const captureTelemetry = (telemetry: LoopTelemetry) => {
  runtimeState.history.push(telemetry);
  if (runtimeState.history.length > 50) {
    runtimeState.history.shift();
  }
};

const buildPrioritySignal = (telemetry: LoopTelemetry, previous?: LoopTelemetry): PrioritySignal => {
  const successDelta = previous ? telemetry.successRate - previous.successRate : telemetry.successRate;
  return {
    successDelta,
    load: telemetry.load,
    trustScore: telemetry.trustScore,
    errorRate: telemetry.errorRate,
    governanceOverride: telemetry.trustScore < 60 ? 0.34 : undefined,
  } satisfies PrioritySignal;
};

const dispatchLoopEvent = async (result: LoopRunResult) => {
  if (!isOrchestrationEnabled()) return;

  try {
    await dispatchEvent({
      type: "insight_report",
      source: "insight",
      payload: {
        summary: result.summary,
        correlations: [],
        context: {
          priorities: result.priorities.map((item) => ({ agent: item.agent, weight: item.weight })),
          scaling: result.scaling.status,
          intervalMs: result.intervalMs,
          recoveryAction: result.recovery.action,
        },
      },
    });
  } catch (error) {
    console.warn("Failed to emit autonomy loop event", error);
  }
};

export const runLoop = async (overrides?: {
  telemetry?: Partial<LoopTelemetry>;
  scaling?: Partial<ScalingState>;
  emitEvent?: boolean;
}): Promise<LoopRunResult> => {
  if (!isAutonomyEnabled()) {
    return {
      enabled: false,
      intervalMs: runtimeState.intervalMs,
      concurrency: runtimeState.concurrency,
      priorities: [],
      scaling: {
        state: { concurrency: runtimeState.concurrency, intervalMs: runtimeState.intervalMs },
        status: "steady",
        reason: "Autonomy dimatikan",
        backlogSize: 0,
        avgLatencyMs: 0,
      },
      recovery: {
        agent: "optimizer",
        action: "noop",
        reason: "Autonomy nonaktif",
        trustScoreBefore: 0,
        trustScoreAfter: 0,
        createdAt: new Date(),
      },
      telemetry: {
        timestamp: new Date().toISOString(),
        load: 0,
        backlogSize: 0,
        trustScore: 0,
        successRate: 0,
        errorRate: 0,
        avgLatencyMs: 0,
      },
      summary: "Loop otonom dinonaktifkan",
      history: [...runtimeState.history],
    } satisfies LoopRunResult;
  }

  runtimeState.enabled = true;

  const trust = await getTrustScore();
  const snapshot = await getOrchestratorSnapshot({ limit: 40 });
  const backlog =
    overrides?.telemetry?.backlogSize ??
    (await sampleBacklogSize(EVENT_STREAM_KEY)) ??
    snapshot.events.length;

  const previousTelemetry = runtimeState.history.at(-1);

  const telemetry: LoopTelemetry = {
    timestamp: new Date().toISOString(),
    load:
      overrides?.telemetry?.load ??
      Math.min(1, snapshot.events.length / Math.max(snapshot.agents.length, 1) / 10),
    backlogSize: backlog,
    trustScore: overrides?.telemetry?.trustScore ?? trust.score,
    successRate: overrides?.telemetry?.successRate ?? trust.metrics.successRate,
    errorRate: overrides?.telemetry?.errorRate ?? trust.metrics.policyViolationRate,
    avgLatencyMs: overrides?.telemetry?.avgLatencyMs ?? 250,
  } satisfies LoopTelemetry;

  captureTelemetry(telemetry);

  const prioritySignal = buildPrioritySignal(telemetry, previousTelemetry);
  const priorityResult = await updateAgentPriorities(prioritySignal);

  const scalingInput = {
    avgLatencyMs: telemetry.avgLatencyMs,
    backlogSize: telemetry.backlogSize,
    trustScore: telemetry.trustScore,
    successRate: telemetry.successRate,
  };

  const currentScaling: ScalingState = {
    concurrency: overrides?.scaling?.concurrency ?? runtimeState.concurrency,
    intervalMs: overrides?.scaling?.intervalMs ?? runtimeState.intervalMs,
  };

  const scalingDecision = evaluateScaling(scalingInput, currentScaling);

  runtimeState.concurrency = scalingDecision.state.concurrency;
  runtimeState.intervalMs = adaptiveInterval(telemetry, scalingDecision.state.intervalMs);

  const recovery = await runRecoverySweep({ errorRate: telemetry.errorRate });

  const summary = `${describeScalingDecision(scalingDecision)} | Prioritas: ${priorityResult.summary} | Recovery: ${recovery.action.toUpperCase()}`;

  if (overrides?.emitEvent !== false) {
    await dispatchLoopEvent({
      enabled: true,
      intervalMs: runtimeState.intervalMs,
      concurrency: runtimeState.concurrency,
      priorities: priorityResult.weights,
      scaling: scalingDecision,
      recovery,
      telemetry,
      summary,
      history: [...runtimeState.history],
    });
  }

  return {
    enabled: true,
    intervalMs: runtimeState.intervalMs,
    concurrency: runtimeState.concurrency,
    priorities: priorityResult.weights,
    scaling: scalingDecision,
    recovery,
    telemetry,
    summary,
    history: [...runtimeState.history],
  } satisfies LoopRunResult;
};

const scheduleNextRun = async () => {
  if (!runtimeState.enabled) return;
  if (runtimeState.timer) {
    clearTimeout(runtimeState.timer);
  }

  runtimeState.timer = setTimeout(async () => {
    try {
      await runLoop();
    } catch (error) {
      console.error("Autonomy loop failure", error);
    } finally {
      await scheduleNextRun();
    }
  }, runtimeState.intervalMs);
};

export const startAutonomyLoop = async () => {
  if (!isAutonomyEnabled()) {
    return { started: false, reason: "ENABLE_AI_AUTONOMY=false" } as const;
  }
  runtimeState.enabled = true;
  await runLoop();
  await scheduleNextRun();
  return { started: true } as const;
};

export const stopAutonomyLoop = () => {
  runtimeState.enabled = false;
  if (runtimeState.timer) {
    clearTimeout(runtimeState.timer);
    runtimeState.timer = null;
  }
};

export const getLoopState = async () => {
  const recoveryLog = await listRecoveryLog({ limit: 10 });
  const priorities = await db.agentPriority.findMany({ orderBy: { updatedAt: "desc" }, take: 10 });
  return {
    enabled: runtimeState.enabled && isAutonomyEnabled(),
    intervalMs: runtimeState.intervalMs,
    concurrency: runtimeState.concurrency,
    history: [...runtimeState.history],
    recentPriorities: priorities,
    recoveryLog,
  };
};
