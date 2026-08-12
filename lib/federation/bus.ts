import crypto, { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  type FederationEndpointStatus,
  type FederationEvent,
  type FederationEventInput,
  type FederationEventType,
  type SignatureAlgorithm,
  federationEventSchema,
  validateFederationEvent,
} from "@/lib/federation/protocol";

const DEFAULT_RECENT_LIMIT = 25;

export const generateFederationKeyPair = (): { publicKey: string; privateKey: string } => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
};

export type FederationBusOptions = {
  tenantId?: string;
  secret?: string;
  privateKey?: string;
  publicKey?: string;
  keyId?: string;
  peerPublicKeys?: Record<string, string>;
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
  private readonly privateKey?: string;
  private readonly publicKey?: string;
  private readonly keyId?: string;
  private readonly peerPublicKeys: Record<string, string>;
  private readonly endpoints: string[];
  private readonly recentLimit: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly enabled: boolean;
  private readonly recent: FederationEvent[] = [];
  private readonly statuses = new Map<string, FederationEndpointStatus>();

  constructor(options?: FederationBusOptions) {
    this.tenantId = options?.tenantId ?? process.env.FEDERATION_TENANT_ID ?? "local";
    this.secret = options?.secret ?? process.env.FEDERATION_TOKEN_SECRET ?? "";
    this.privateKey = options?.privateKey ?? process.env.FEDERATION_PRIVATE_KEY;
    this.publicKey = options?.publicKey ?? process.env.FEDERATION_PUBLIC_KEY;
    this.keyId = options?.keyId ?? process.env.FEDERATION_KEY_ID;
    this.peerPublicKeys = options?.peerPublicKeys ?? {};
    this.endpoints = options?.endpoints ?? toEndpointList(process.env.FEDERATION_ENDPOINTS);
    this.recentLimit = options?.recentLimit ?? DEFAULT_RECENT_LIMIT;
    this.fetchImpl = options?.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
    this.enabled = determineEnabled(options);

    for (const endpoint of this.endpoints) {
      this.statuses.set(endpoint, { endpoint, healthy: false });
    }
  }

  get isEnabled() {
    return (
      this.enabled &&
      (Boolean(this.secret) || Boolean(this.privateKey) || Boolean(this.publicKey))
    );
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

  private getSignableString(
    prepared: { type: string; tenantId: string; timestamp: string; payload?: unknown },
    encryptedFields?: { encryptedPayload?: string; encryptedKey?: string; iv?: string },
  ): string {
    if (encryptedFields?.encryptedPayload) {
      return JSON.stringify({
        type: prepared.type,
        tenantId: prepared.tenantId,
        timestamp: prepared.timestamp,
        encryptedPayload: encryptedFields.encryptedPayload,
        encryptedKey: encryptedFields.encryptedKey,
        iv: encryptedFields.iv,
      });
    }
    return JSON.stringify({
      type: prepared.type,
      tenantId: prepared.tenantId,
      timestamp: prepared.timestamp,
      payload: prepared.payload,
    });
  }

  private sign(signableString: string): {
    signature: string;
    signatureAlgorithm: SignatureAlgorithm;
  } {
    if (this.privateKey) {
      const signer = crypto.createSign("SHA256");
      signer.update(signableString);
      signer.end();
      const signature = signer.sign(this.privateKey, "hex");
      return { signature, signatureAlgorithm: "rsa-sha256" };
    }
    const hmac = createHmac("sha256", this.secret);
    hmac.update(signableString);
    return { signature: hmac.digest("hex"), signatureAlgorithm: "hmac-sha256" };
  }

  private encryptPayload(
    payload: unknown,
    recipientPublicKey: string,
  ): { encryptedPayload: string; encryptedKey: string; iv: string } {
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    let cipherText = cipher.update(JSON.stringify(payload), "utf8");
    cipherText = Buffer.concat([cipherText, cipher.final()]);
    const authTag = cipher.getAuthTag();

    const combinedPayloadBuffer = Buffer.concat([cipherText, authTag]);
    const encryptedPayload = combinedPayloadBuffer.toString("base64");

    const encryptedKeyBuffer = crypto.publicEncrypt(
      {
        key: recipientPublicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      aesKey,
    );
    const encryptedKey = encryptedKeyBuffer.toString("base64");

    return {
      encryptedPayload,
      encryptedKey,
      iv: iv.toString("hex"),
    };
  }

  private decryptPayload(
    encryptedPayloadBase64: string,
    encryptedKeyBase64: string,
    ivHex: string,
  ): unknown {
    if (!this.privateKey) {
      throw new Error("Cannot decrypt event: Private key missing");
    }

    let aesKey: Buffer;
    try {
      const encryptedKeyBuffer = Buffer.from(encryptedKeyBase64, "base64");
      aesKey = crypto.privateDecrypt(
        {
          key: this.privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        encryptedKeyBuffer,
      );
    } catch (error) {
      throw new Error(
        `Payload decryption failed: ${error instanceof Error ? error.message : "Invalid key"}`,
      );
    }

    const combinedPayloadBuffer = Buffer.from(encryptedPayloadBase64, "base64");
    const AUTH_TAG_LENGTH = 16;
    if (combinedPayloadBuffer.length < AUTH_TAG_LENGTH) {
      throw new Error("Corrupted encrypted payload: buffer too short");
    }

    const cipherText = combinedPayloadBuffer.subarray(
      0,
      combinedPayloadBuffer.length - AUTH_TAG_LENGTH,
    );
    const authTag = combinedPayloadBuffer.subarray(
      combinedPayloadBuffer.length - AUTH_TAG_LENGTH,
    );
    const iv = Buffer.from(ivHex, "hex");

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
      decipher.setAuthTag(authTag);
      let decryptedText = decipher.update(cipherText, undefined, "utf8");
      decryptedText += decipher.final("utf8");

      return JSON.parse(decryptedText);
    } catch (error) {
      throw new Error(
        `Payload decryption failed: ${error instanceof Error ? error.message : "Ciphertext corruption"}`,
      );
    }
  }

  private buildEvent<TType extends FederationEventType>(
    input: FederationEventInput<TType>,
  ): FederationEvent<TType> {
    const prepared = validateFederationEvent(input);
    const id = randomUUID();

    let encryptedFields:
      | { encryptedPayload: string; encryptedKey: string; iv: string }
      | undefined;

    if (input.recipientPublicKey) {
      encryptedFields = this.encryptPayload(prepared.payload, input.recipientPublicKey);
    }

    const signableString = this.getSignableString(prepared, encryptedFields);
    const { signature, signatureAlgorithm } = this.sign(signableString);

    const rawEvent: Record<string, unknown> = {
      id,
      type: prepared.type,
      tenantId: prepared.tenantId,
      timestamp: prepared.timestamp,
      signature,
      signatureAlgorithm,
      keyId: this.keyId || undefined,
    };

    if (encryptedFields) {
      rawEvent.encryptedPayload = encryptedFields.encryptedPayload;
      rawEvent.encryptedKey = encryptedFields.encryptedKey;
      rawEvent.iv = encryptedFields.iv;
    } else {
      rawEvent.payload = prepared.payload;
    }

    const event = federationEventSchema.parse(rawEvent) as FederationEvent<TType>;
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

  private verifySignature(event: FederationEvent): boolean {
    const signableString = event.encryptedPayload
      ? JSON.stringify({
          type: event.type,
          tenantId: event.tenantId,
          timestamp: event.timestamp,
          encryptedPayload: event.encryptedPayload,
          encryptedKey: event.encryptedKey,
          iv: event.iv,
        })
      : JSON.stringify({
          type: event.type,
          tenantId: event.tenantId,
          timestamp: event.timestamp,
          payload: event.payload,
        });

    const senderPublicKey = this.peerPublicKeys[event.tenantId] ?? this.publicKey;

    if (
      event.signatureAlgorithm === "rsa-sha256" ||
      (senderPublicKey && event.signatureAlgorithm !== "hmac-sha256")
    ) {
      if (!senderPublicKey) return false;
      try {
        const verifier = crypto.createVerify("SHA256");
        verifier.update(signableString);
        verifier.end();
        return verifier.verify(senderPublicKey, Buffer.from(event.signature, "hex"));
      } catch {
        return false;
      }
    }

    // Fallback to HMAC-SHA256
    if (!this.secret) return false;
    const expected = createHmac("sha256", this.secret).update(signableString).digest();
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

    if (parsed.encryptedPayload && parsed.encryptedKey && parsed.iv) {
      const decryptedPayload = this.decryptPayload(
        parsed.encryptedPayload,
        parsed.encryptedKey,
        parsed.iv,
      );
      parsed.payload = decryptedPayload as typeof parsed.payload;
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
