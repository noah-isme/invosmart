import { randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { db } from "@/lib/db";

import {
  AGENT_NAMES,
  EVENT_STREAM_KEY,
  agentRoleSchema,
  createEventTimestamp,
  ensurePriority,
  mapEventSchema,
  sortEventsByGovernance,
  type AgentRegistration,
  type AgentRegistrationInput,
  type AgentRole,
  type MapEvent,
  type MapEventInput,
} from "./protocol";

const DEFAULT_STREAM_LENGTH = 200;

type AgentEventLogDelegate = typeof db.agentEventLog | undefined;

const getAgentEventLog = (): AgentEventLogDelegate => {
  const candidate = (db as typeof db & { agentEventLog?: AgentEventLogDelegate }).agentEventLog;
  return candidate ?? undefined;
};

const registry = new Map<AgentRole, AgentRegistration>();

const useMemoryStream =
  process.env.NODE_ENV === "test" ||
  process.env.ENABLE_AI_ORCHESTRATION === "memory" ||
  !process.env.UPSTASH_REDIS_REST_URL ||
  !process.env.UPSTASH_REDIS_REST_TOKEN;

type StreamEntry = { id: string; event: MapEvent };

type RedisStreamClient = {
  xadd: (key: string, id: string, entries: Record<string, unknown>) => Promise<string>;
  xrange: (
    key: string,
    start: string,
    end: string,
    opts?: { count?: number } | number,
  ) => Promise<Array<[string, Record<string, string>]>>;
  xlen?: (key: string) => Promise<number>;
  xtrim?: (key: string, strategy: string, threshold: number) => Promise<number | string>;
  del?: (key: string) => Promise<number | void>;
};

class MemoryStream implements RedisStreamClient {
  private streams = new Map<string, StreamEntry[]>();

  async xadd(key: string, id: string, entries: Record<string, unknown>): Promise<string> {
    const stream = this.streams.get(key) ?? [];
    const entryId = id === "*" ? `${Date.now()}-${stream.length + 1}` : id;
    const eventJson = entries.event as string;
    const parsed = JSON.parse(eventJson) as MapEvent;
    stream.push({ id: entryId, event: parsed });
    if (stream.length > DEFAULT_STREAM_LENGTH) {
      stream.shift();
    }
    this.streams.set(key, stream);
    return entryId;
  }

  async xrange(
    key: string,
    _start: string,
    _end: string,
    opts?: { count?: number } | number,
  ): Promise<Array<[string, Record<string, string>]>> {
    const stream = this.streams.get(key) ?? [];
    const count = typeof opts === "number" ? opts : opts?.count;
    const sliced = count ? stream.slice(-count) : stream;
    return sliced.map((entry) => [entry.id, { event: JSON.stringify(entry.event) }]) as Array<[
      string,
      Record<string, string>,
    ]>;
  }

  async del(key: string): Promise<void> {
    this.streams.delete(key);
  }

  async xlen(key: string): Promise<number> {
    const stream = this.streams.get(key) ?? [];
    return stream.length;
  }

  async xtrim(key: string, _strategy: string, threshold: number): Promise<number> {
    const stream = this.streams.get(key) ?? [];
    if (stream.length <= threshold) return 0;
    const trimmed = stream.slice(-threshold);
    this.streams.set(key, trimmed);
    return stream.length - trimmed.length;
  }
}

const memoryStream = new MemoryStream();

const createRedisStreamClient = (): RedisStreamClient => {
  const client = Redis.fromEnv();
  return {
    xadd: (key, id, entries) => client.xadd(key, id, entries),
    xrange: async (key, start, end, opts) => {
      const count = typeof opts === "number" ? opts : opts?.count;
      const rawEntries = (await client.xrange(key, start, end, count)) as unknown;
      if (Array.isArray(rawEntries)) {
        return rawEntries.map(([id, fields]) => [id, fields as Record<string, string>]);
      }
      return Object.entries(rawEntries as Record<string, Record<string, string>>).map(([id, fields]) => [
        id,
        fields,
      ]);
    },
    xlen: client.xlen ? (key) => client.xlen!(key) : undefined,
    xtrim: client.xtrim
      ? (key, strategy, threshold) => {
          const normalizedStrategy = strategy === "MINID" ? "MINID" : "MAXLEN";
          return client.xtrim!(key, { strategy: normalizedStrategy, threshold });
        }
      : undefined,
    del: client.del ? (key) => client.del!(key) : undefined,
  } satisfies RedisStreamClient;
};

const getRedisClient = (): RedisStreamClient => {
  if (useMemoryStream) {
    return memoryStream;
  }
  return createRedisStreamClient();
};

export const isOrchestrationEnabled = () => process.env.ENABLE_AI_ORCHESTRATION !== "false";

export const registerAgent = (input: AgentRegistrationInput): AgentRegistration => {
  const parsedAgent = agentRoleSchema.parse(input.agentId);
  const registration: AgentRegistration = {
    agentId: parsedAgent,
    name: input.name,
    description: input.description,
    capabilities: input.capabilities ?? [],
    priority: ensurePriority(parsedAgent, input.priorityOverride),
    streamKey: `${EVENT_STREAM_KEY}:${parsedAgent}`,
    registeredAt: createEventTimestamp(),
  };

  registry.set(parsedAgent, registration);
  return registration;
};

const truncateStreamIfNeeded = async () => {
  if (useMemoryStream) return;
  try {
    const redis = getRedisClient();
    if (typeof redis.xlen !== "function" || typeof redis.xtrim !== "function") {
      return;
    }
    const length = await redis.xlen(EVENT_STREAM_KEY);
    if (length && length > DEFAULT_STREAM_LENGTH) {
      await redis.xtrim(EVENT_STREAM_KEY, "MAXLEN", DEFAULT_STREAM_LENGTH);
    }
  } catch (error) {
    console.warn("Failed to truncate orchestrator stream", error);
  }
};

const persistEvent = async (event: MapEvent) => {
  const agentEventLog = getAgentEventLog();
  if (!agentEventLog?.create) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('AgentEventLog delegate unavailable, skipping persistence');
    }
    return;
  }

  await agentEventLog.create({
    data: {
      traceId: event.traceId,
      eventType: event.type,
      sourceAgent: event.source,
      targetAgent: event.target ?? null,
      priority: event.priority,
      summary: event.payload.summary,
      payload: event.payload,
      recommendationId: "recommendationId" in event.payload ? event.payload.recommendationId ?? null : null,
    },
  });
};

export const dispatchEvent = async (input: MapEventInput): Promise<MapEvent | null> => {
  if (!isOrchestrationEnabled()) {
    return null;
  }

  const enriched = {
    ...input,
    traceId: input.traceId ?? randomUUID(),
    timestamp: input.timestamp ?? createEventTimestamp(),
    priority: ensurePriority(input.source, input.priority),
  } satisfies MapEventInput;

  const event = mapEventSchema.parse(enriched);

  const redis = getRedisClient();
  const payload = JSON.stringify(event);
  await redis.xadd(EVENT_STREAM_KEY, "*", { event: payload, traceId: event.traceId, priority: event.priority });
  await truncateStreamIfNeeded();
  await persistEvent(event);

  return event;
};

export const resolveConflict = (events: MapEvent[]): MapEvent | null => {
  if (!events.length) return null;
  const sorted = sortEventsByGovernance(events);
  return sorted[0] ?? null;
};

export type OrchestratorSnapshot = {
  agents: AgentRegistration[];
  events: MapEvent[];
};

export const getOrchestratorSnapshot = async ({ limit = 25 } = {}): Promise<OrchestratorSnapshot> => {
  if (!isOrchestrationEnabled()) {
    return { agents: Array.from(registry.values()), events: [] };
  }

  const redis = getRedisClient();
  let rawEntries: Array<[string, Record<string, string>]> = [];
  try {
    rawEntries = await redis.xrange(EVENT_STREAM_KEY, "-", "+", { count: limit });
  } catch (error) {
    console.warn("Failed to read orchestrator events", error);
  }

  const parsedEvents: MapEvent[] = [];
  rawEntries.forEach(([, entry]) => {
    const payload = entry.event;
    if (!payload) return;
    try {
      const parsed = mapEventSchema.parse(JSON.parse(payload));
      parsedEvents.push(parsed);
    } catch (error) {
      console.warn("Skipping invalid event payload", error);
    }
  });

  const recentEvents = parsedEvents.slice(-limit);

  return {
    agents: Array.from(registry.values()),
    events: recentEvents,
  };
};

export const getLatestEvaluationForRecommendation = async (
  recommendationId: string,
): Promise<MapEvent | null> => {
  if (!isOrchestrationEnabled()) {
    return null;
  }

  const agentEventLog = getAgentEventLog();
  if (!agentEventLog?.findFirst) {
    return null;
  }

  const log = await agentEventLog.findFirst({
    where: {
      recommendationId,
      eventType: "evaluation",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!log) return null;

  return mapEventSchema.parse({
    traceId: log.traceId,
    type: log.eventType,
    source: log.sourceAgent,
    target: log.targetAgent ?? undefined,
    priority: log.priority,
    timestamp: log.createdAt.toISOString(),
    payload: log.payload as MapEvent["payload"],
  });
};

export const listRegisteredAgents = (): AgentRegistration[] => {
  return Array.from(registry.values());
};

export const getAgentName = (agent: AgentRole) => AGENT_NAMES[agent];

export const __dangerousResetOrchestrator = async () => {
  registry.clear();
  if (useMemoryStream) {
    await memoryStream.del(EVENT_STREAM_KEY);
  } else {
    const redis = getRedisClient();
    if (typeof redis.del === "function") {
      await redis.del(EVENT_STREAM_KEY);
    }
  }
  const agentEventLog = getAgentEventLog();
  if (agentEventLog?.deleteMany) {
    await agentEventLog.deleteMany();
  }
};
