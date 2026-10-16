import crypto, { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { db } from "@/lib/db";

import {
  type FederationEndpointStatus,
  type FederationEvent,
  type FederationEventInput,
  type FederationEventType,
  type SignatureAlgorithm,
  federationEventSchema,
  parseFederationPayload,
  validateFederationEvent,
} from "@/lib/federation/protocol";

const DEFAULT_RECENT_LIMIT = 25;

/** Inbound events whose timestamp is further than this from local time are rejected. */
export const FEDERATION_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type FederationInboundRecord = {
  eventId: string;
  tenantId: string;
  type: string;
  signatureAlgorithm: string;
  signatureHash: string;
  eventTimestamp: Date;
  accepted: boolean;
};

/** The slice of `db.federationInboundEvent` the bus needs (injectable for tests). */
export type FederationInboundStore = {
  create(args: { data: FederationInboundRecord }): Promise<unknown>;
};

const isUniqueConstraintError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "P2002";

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
  /** Bearer token sent to peers (FEDERATION_TOKEN_SECRET). Never used as a signing key. */
  secret?: string;
  /** HMAC-SHA256 signing key (FEDERATION_HMAC_SECRET); must differ from the bearer token. */
  hmacSecret?: string;
  privateKey?: string;
  publicKey?: string;
  keyId?: string;
  peerPublicKeys?: Record<string, string>;
  endpoints?: string[];
  enabled?: boolean;
  recentLimit?: number;
  fetchImpl?: typeof fetch;
  /** Replay log; defaults to `db.federationInboundEvent`. */
  inboundStore?: FederationInboundStore;
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
  private readonly hmacSecret: string;
  private readonly privateKey?: string;
  private readonly publicKey?: string;
  private readonly keyId?: string;
  private readonly peerPublicKeys: Record<string, string>;
  private readonly endpoints: string[];
  private readonly recentLimit: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly enabled: boolean;
  private readonly inboundStore?: FederationInboundStore;
  private readonly recent: FederationEvent[] = [];
  private readonly statuses = new Map<string, FederationEndpointStatus>();

  constructor(options?: FederationBusOptions) {
    this.tenantId = options?.tenantId ?? process.env.FEDERATION_TENANT_ID ?? "local";
    this.secret = options?.secret ?? process.env.FEDERATION_TOKEN_SECRET ?? "";
    this.hmacSecret = options?.hmacSecret ?? process.env.FEDERATION_HMAC_SECRET ?? "";
    this.privateKey = options?.privateKey ?? process.env.FEDERATION_PRIVATE_KEY;
    this.publicKey = options?.publicKey ?? process.env.FEDERATION_PUBLIC_KEY;
    this.keyId = options?.keyId ?? process.env.FEDERATION_KEY_ID;
    this.peerPublicKeys = options?.peerPublicKeys ?? {};
    this.endpoints = options?.endpoints ?? toEndpointList(process.env.FEDERATION_ENDPOINTS);
    this.recentLimit = options?.recentLimit ?? DEFAULT_RECENT_LIMIT;
    this.fetchImpl = options?.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
    this.enabled = determineEnabled(options);
    this.inboundStore = options?.inboundStore;

    for (const endpoint of this.endpoints) {
      this.statuses.set(endpoint, { endpoint, healthy: false });
    }
  }

  get isEnabled() {
    return (
      this.enabled &&
      (Boolean(this.secret) ||
        Boolean(this.hmacSecret) ||
        Boolean(this.privateKey) ||
        Boolean(this.publicKey))
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
    // The HMAC key is deliberately separate from the bearer token that deliver()
    // sends to every peer: keying HMAC with the bearer would let any bearer
    // holder forge events for any tenant. No silent fallback.
    if (!this.hmacSecret) {
      throw new Error(
        "Federation signing key missing: set FEDERATION_PRIVATE_KEY or FEDERATION_HMAC_SECRET",
      );
    }
    const hmac = createHmac("sha256", this.hmacSecret);
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
    // Peers verify the signature over what is sent, so validation must not
    // have changed a single field of what was signed.
    if (this.getSignableString(event, event) !== signableString) {
      throw new Error("Federation event changed during validation; refusing to send");
    }
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
      // Listeners run detached from publish()/ingest(); a failing one must not
      // throw into the emitter or become an unhandled rejection.
      const report = (error: unknown) => {
        console.error("[federation] subscriber failed", {
          type,
          message: error instanceof Error ? error.message : String(error),
        });
      };
      try {
        void Promise.resolve(listener(event as FederationEvent<TType>)).catch(report);
      } catch (error) {
        report(error);
      }
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

    const registeredPeerKey = this.peerPublicKeys[event.tenantId];
    // A tenant with a registered public key must sign with RSA; accepting HMAC
    // for it would let anyone holding the shared HMAC key impersonate it.
    if (registeredPeerKey && event.signatureAlgorithm === "hmac-sha256") return false;

    const senderPublicKey = registeredPeerKey ?? this.publicKey;

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

    // HMAC-SHA256 with the dedicated HMAC key (never the bearer token).
    if (!this.hmacSecret) return false;
    const expected = createHmac("sha256", this.hmacSecret).update(signableString).digest();
    const provided = Buffer.from(event.signature, "hex");

    if (expected.length !== provided.length) return false;

    return timingSafeEqual(expected, provided);
  }

  /**
   * Verifies and delivers an inbound event to local subscribers.
   *
   * Order: schema -> signature -> freshness -> echo check -> decrypt and
   * validate the payload -> replay insert -> record/emit. Every event that
   * passes the signature and the freshness window and is about to be emitted
   * is written to FederationInboundEvent with accepted=true (echoes of this
   * instance's own events with accepted=false). The row is written only after
   * the payload decrypted and validated, so a failed event never leaves an
   * accepted row behind; the unique signatureHash makes a second copy of an
   * accepted (or echoed) signed event fail with "Duplicate federation event",
   * even when it carries a fresh `id` (the id is not signed).
   *
   * Returns true when the event was emitted, false for disabled buses and
   * own-tenant echoes.
   */
  async ingest(event: FederationEvent) {
    if (!this.isEnabled) return false;

    const parsed = federationEventSchema.parse(event) as FederationEvent;
    if (!this.verifySignature(parsed)) {
      throw new Error("Invalid federation signature");
    }

    const eventTime = Date.parse(parsed.timestamp);
    if (!Number.isFinite(eventTime) || Math.abs(Date.now() - eventTime) > FEDERATION_MAX_CLOCK_SKEW_MS) {
      throw new Error("Stale federation event");
    }

    // Echoes of our own events are recorded (accepted=false) but never emitted.
    const accepted = parsed.tenantId !== this.tenantId;

    if (accepted && parsed.encryptedPayload && parsed.encryptedKey && parsed.iv) {
      const decryptedPayload = this.decryptPayload(
        parsed.encryptedPayload,
        parsed.encryptedKey,
        parsed.iv,
      );
      // The ciphertext is signed, but its plaintext is validated like any other payload.
      parsed.payload = parseFederationPayload(parsed.type, decryptedPayload) as typeof parsed.payload;
    }

    const store = this.inboundStore ?? db.federationInboundEvent;
    try {
      await store.create({
        data: {
          eventId: parsed.id,
          tenantId: parsed.tenantId,
          type: parsed.type,
          signatureAlgorithm: parsed.signatureAlgorithm ?? "hmac-sha256",
          // Hash the decoded bytes, not the string: Buffer.from(hex) ignores case
          // and trailing junk, so string variants of one signature still verify.
          signatureHash: createHash("sha256")
            .update(Buffer.from(parsed.signature, "hex"))
            .digest("hex"),
          eventTimestamp: new Date(eventTime),
          accepted,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error("Duplicate federation event");
      }
      throw error;
    }

    if (!accepted) {
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
