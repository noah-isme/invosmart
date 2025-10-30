import { Redis } from "@upstash/redis";

export type ScalingMetrics = {
  avgLatencyMs: number;
  backlogSize: number;
  trustScore: number;
  successRate: number;
};

export type ScalingState = {
  concurrency: number;
  intervalMs: number;
};

export type ScalingDecision = {
  state: ScalingState;
  status: "scale_up" | "scale_down" | "steady";
  reason: string;
  backlogSize: number;
  avgLatencyMs: number;
};

const MIN_INTERVAL = 60_000;
const MAX_INTERVAL = 15 * 60_000;
const MAX_CONCURRENCY = 6;
const MIN_CONCURRENCY = 1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getRedis = () => {
  try {
    return Redis.fromEnv();
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("Redis client unavailable, scaling decisions will rely on provided backlog.", error);
    }
    return null;
  }
};

export const sampleBacklogSize = async (streamKey: string): Promise<number | null> => {
  const redis = getRedis();
  if (!redis?.xlen) return null;

  try {
    const length = await redis.xlen(streamKey);
    return typeof length === "number" ? length : Number(length);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("Failed to read redis backlog", error);
    }
    return null;
  }
};

export const evaluateScaling = (
  metrics: ScalingMetrics,
  current: ScalingState,
): ScalingDecision => {
  const latencyScore = clamp(metrics.avgLatencyMs / 1_000, 0, 1);
  const backlogScore = clamp(metrics.backlogSize / 50, 0, 1);
  const trustPenalty = 1 - clamp(metrics.trustScore / 100, 0, 1);
  const successBoost = clamp(metrics.successRate, 0, 1);

  const pressure = latencyScore * 0.35 + backlogScore * 0.4 + trustPenalty * 0.15 - successBoost * 0.2;

  let status: ScalingDecision["status"] = "steady";
  let nextConcurrency = current.concurrency;
  let nextInterval = current.intervalMs;
  let reason = "Beban stabil";

  if (pressure > 0.35) {
    status = "scale_up";
    nextConcurrency = clamp(current.concurrency + 1, MIN_CONCURRENCY, MAX_CONCURRENCY);
    nextInterval = clamp(Math.round(current.intervalMs * 0.8), MIN_INTERVAL, MAX_INTERVAL);
    reason = "Backlog dan latency tinggi, meningkatkan frekuensi loop";
  } else if (pressure < -0.15) {
    status = "scale_down";
    nextConcurrency = clamp(current.concurrency - 1, MIN_CONCURRENCY, MAX_CONCURRENCY);
    nextInterval = clamp(Math.round(current.intervalMs * 1.2), MIN_INTERVAL, MAX_INTERVAL);
    reason = "Sistem idle, menurunkan frekuensi untuk hemat resource";
  }

  return {
    state: { concurrency: nextConcurrency, intervalMs: nextInterval },
    status,
    reason,
    backlogSize: metrics.backlogSize,
    avgLatencyMs: metrics.avgLatencyMs,
  } satisfies ScalingDecision;
};

export const describeScalingDecision = (decision: ScalingDecision): string => {
  const intervalMinutes = (decision.state.intervalMs / 60_000).toFixed(2);
  return `${decision.status.toUpperCase()} · interval ${intervalMinutes}m · concurrency ${decision.state.concurrency} → ${decision.reason}`;
};
