import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  type FederationEndpointStatus,
  type FederationEvent,
  type FederationEventInput,
  type FederationEventType,
  federationEventSchema,
  validateFederationEvent,
  type PreparedFederationEvent,
} from "@/lib/federation/protocol";

const DEFAULT_RECENT_LIMIT = 25;

export type FederationBusOptions = {
  tenantId?: string;
  secret?: string;
  endpoints?: string[];
  enabled?: boolean;
  recentLimit?: number;
  fetchImpl?: typeof fetch;
};

type Listener<TType extends FederationEventType> = (event: FederationEvent<TType>) => void | Promise<void>;

type DeliveryResult = {
  endpoint: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

const toEndpointList = (value?: string | string[]) => {
  if (!value) return [] as string[];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const determineEnabled = (options?: FederationBusOptions) => {
  if (typeof options?.enabled === "boolean") return options.enabled;
  if (process.env.ENABLE_AI_FEDERATION === "false") return false;
  return process.env.ENABLE_AI_FEDERATION !== "0";
};

export class FederationBus {
  private readonly emitter = new EventEmitter();
  private readonly tenantId: string;
  private readonly secret: string;
  private readonly endpoints: string[];
  private readonly recentLimit: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly enabled: boolean;
  private readonly recent: FederationEvent[] = [];
  private readonly statuses = new Map<string, FederationEndpointStatus>();

  constructor(options?: FederationBusOptions) {
    this.tenantId = options?.tenantId ?? process.env.FEDERATION_TENANT_ID ?? "local";
    this.secret = options?.secret ?? process.env.FEDERATION_TOKEN_SECRET ?? "";
    this.endpoints = options?.endpoints ?? toEndpointList(process.env.FEDERATION_ENDPOINTS);
    this.recentLimit = options?.recentLimit ?? DEFAULT_RECENT_LIMIT;
    this.fetchImpl = options?.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
    this.enabled = determineEnabled(options);

    for (const endpoint of this.endpoints) {
      this.statuses.set(endpoint, { endpoint, healthy: false });
    }
  }

  get isEnabled() {
    return this.enabled && Boolean(this.secret);
  }

  getTenantId() {
    return this.tenantId;
  }

  getEndpoints() {
    return [...this.endpoints];
  }

  getRecentEvents() {
    return [...this.recent];
  }

  getConnectionStatuses(): FederationEndpointStatus[] {
    return Array.from(this.statuses.values()).map((status) => ({ ...status }));
  }

  private recordEvent(event: FederationEvent) {
    this.recent.unshift(event);
    if (this.recent.length > this.recentLimit) {
      this.recent.length = this.recentLimit;
    }
  }

  private sign(prepared: PreparedFederationEvent) {
    const payload = JSON.stringify({
      type: prepared.type,
      tenantId: prepared.tenantId,
      timestamp: prepared.timestamp,
      payload: prepared.payload,
    });
    const hmac = createHmac("sha256", this.secret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  private buildEvent<TType extends FederationEventType>(
    input: FederationEventInput<TType>,
  ): FederationEvent<TType> {
    const prepared = validateFederationEvent(input);
    const id = randomUUID();
    const signature = this.sign(prepared);

    const event = federationEventSchema.parse({
      id,
      signature,
      ...prepared,
    }) as FederationEvent<TType>;

    return event;
  }

  private updateEndpointStatus(endpoint: string, result: DeliveryResult) {
    const existing = this.statuses.get(endpoint) ?? { endpoint, healthy: false };
    const next: FederationEndpointStatus = {
      ...existing,
      endpoint,
      healthy: result.ok,
      lastAttempt: new Date().toISOString(),
      lastLatencyMs: result.latencyMs,
      error: result.error,
    };
    this.statuses.set(endpoint, next);
  }

  private async deliver(endpoint: string, event: FederationEvent): Promise<DeliveryResult> {
    if (!this.fetchImpl) {
      return { endpoint, ok: false, error: "fetch unavailable" } satisfies DeliveryResult;
    }

    const started = Date.now();
    try {
      const response = await this.fetchImpl(`${endpoint.replace(/\/$/, "")}/api/federation/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.secret}`,
        },
        body: JSON.stringify(event),
      });

      const latencyMs = Date.now() - started;
      const ok = response.ok;
      const error = ok ? undefined : `HTTP ${response.status}`;
      return { endpoint, ok, latencyMs, error } satisfies DeliveryResult;
    } catch (error) {
      return {
        endpoint,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      } satisfies DeliveryResult;
    }
  }

  async publish<TType extends FederationEventType>(input: FederationEventInput<TType>) {
    if (!this.isEnabled) {
      return { event: null, deliveries: [] as DeliveryResult[] } as const;
    }

    const event = this.buildEvent({ ...input, tenantId: input.tenantId ?? this.tenantId });
    this.recordEvent(event);

    // Emit locally first so subscribers can react even if delivery fails.
    this.emitter.emit(event.type, event);

    const deliveries = await Promise.all(
      this.endpoints.map(async (endpoint) => {
        const result = await this.deliver(endpoint, event);
        this.updateEndpointStatus(endpoint, result);
        return result;
      }),
    );

    return { event, deliveries } as const;
  }

  subscribe<TType extends FederationEventType>(type: TType, listener: Listener<TType>) {
    const wrapped = (event: FederationEvent) => {
      if (event.type !== type) return;
      void listener(event as FederationEvent<TType>);
    };
    this.emitter.on(type, wrapped);

    return () => this.emitter.off(type, wrapped);
  }

  private verifySignature(event: FederationEvent) {
    if (!this.secret) return false;
    const payload = JSON.stringify({
      type: event.type,
      tenantId: event.tenantId,
      timestamp: event.timestamp,
      payload: event.payload,
    });
    const expected = createHmac("sha256", this.secret).update(payload).digest();
    const provided = Buffer.from(event.signature, "hex");

    if (expected.length !== provided.length) return false;

    return timingSafeEqual(expected, provided);
  }

  async ingest(event: FederationEvent) {
    if (!this.isEnabled) return false;

    const parsed = federationEventSchema.parse(event);
    if (!this.verifySignature(parsed)) {
      throw new Error("Invalid federation signature");
    }

    if (parsed.tenantId === this.tenantId) {
      // Ignore echoes of our own events.
      return false;
    }

    this.recordEvent(parsed);
    this.emitter.emit(parsed.type, parsed);
    return true;
  }

  async checkConnections() {
    const fetcher = this.fetchImpl;
    if (!this.isEnabled || !fetcher) {
      return this.getConnectionStatuses();
    }

    await Promise.all(
      this.endpoints.map(async (endpoint) => {
        const started = Date.now();
        try {
          const response = await fetcher(`${endpoint.replace(/\/$/, "")}/api/federation/status`, {
            method: "GET",
            headers: { Authorization: `Bearer ${this.secret}` },
          });
          const latencyMs = Date.now() - started;
          const ok = response.ok;
          this.updateEndpointStatus(endpoint, {
            endpoint,
            ok,
            latencyMs,
            error: ok ? undefined : `HTTP ${response.status}`,
          });
        } catch (error) {
          this.updateEndpointStatus(endpoint, {
            endpoint,
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }),
    );

    return this.getConnectionStatuses();
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      tenantId: this.tenantId,
      endpoints: this.getEndpoints(),
      recentEvents: this.getRecentEvents(),
      connections: this.getConnectionStatuses(),
    } as const;
  }
}

let singleton: FederationBus | null = null;

export const getFederationBus = () => {
  if (!singleton) {
    singleton = new FederationBus();
  }
  return singleton;
};

export const federationBus = getFederationBus();
