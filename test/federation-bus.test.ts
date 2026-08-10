import { describe, expect, it, vi, beforeEach } from "vitest";

import { FederationBus, generateFederationKeyPair } from "@/lib/federation/bus";
import type { FederationEvent } from "@/lib/federation/protocol";

describe("FederationBus", () => {
  const secret = "secret-key";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("publishes events and notifies subscribers", async () => {
    const bus = new FederationBus({
      tenantId: "tenant-a",
      secret,
      endpoints: ["https://tenant-b.com"],
      enabled: true,
      fetchImpl: fetchMock,
    });

    const listener = vi.fn();
    bus.subscribe("telemetry_sync", listener);

    fetchMock.mockResolvedValue({ ok: true });

    const result = await bus.publish({
      type: "telemetry_sync",
      payload: {
        tenantId: "tenant-a",
        trustScore: 72,
        priorities: [],
        sanitized: true,
        trustMetrics: {
          successRate: 0.8,
          rollbackRate: 0.1,
          policyViolationRate: 0.05,
          totalRecommendations: 10,
        },
      },
    });

    expect(result.event).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://tenant-b.com/api/federation/events",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verifies signatures when ingesting remote events", async () => {
    const producer = new FederationBus({ tenantId: "tenant-a", secret, enabled: true });
    const consumer = new FederationBus({ tenantId: "tenant-b", secret, enabled: true });

    const listener = vi.fn();
    consumer.subscribe("telemetry_sync", listener);

    const { event } = await producer.publish({
      type: "telemetry_sync",
      payload: {
        tenantId: "tenant-a",
        trustScore: 85,
        priorities: [],
        sanitized: true,
      },
    });

    expect(event).not.toBeNull();
    const ingested = await consumer.ingest(event as FederationEvent);
    expect(ingested).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects events with invalid signatures", async () => {
    const consumer = new FederationBus({ tenantId: "tenant-b", secret, enabled: true });

    const invalidEvent: FederationEvent = {
      id: "evt-1",
      type: "telemetry_sync",
      tenantId: "tenant-a",
      timestamp: new Date().toISOString(),
      signature: "deadbeef1234",
      payload: {
        tenantId: "tenant-a",
        trustScore: 70,
        priorities: [],
        sanitized: true,
      },
    };

    await expect(consumer.ingest(invalidEvent)).rejects.toThrow(/Invalid federation signature/);
  });

  it("generates RSA keypairs with generateFederationKeyPair()", () => {
    const keys = generateFederationKeyPair();
    expect(keys.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
    expect(keys.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("supports asymmetric digital signing and verification (rsa-sha256)", async () => {
    const producerKeys = generateFederationKeyPair();
    const consumerKeys = generateFederationKeyPair();

    const producer = new FederationBus({
      tenantId: "tenant-a",
      privateKey: producerKeys.privateKey,
      publicKey: producerKeys.publicKey,
      keyId: "key-a",
      peerPublicKeys: { "tenant-b": consumerKeys.publicKey },
      enabled: true,
    });

    const consumer = new FederationBus({
      tenantId: "tenant-b",
      privateKey: consumerKeys.privateKey,
      publicKey: consumerKeys.publicKey,
      keyId: "key-b",
      peerPublicKeys: { "tenant-a": producerKeys.publicKey },
      enabled: true,
    });

    const listener = vi.fn();
    consumer.subscribe("telemetry_sync", listener);

    const { event } = await producer.publish({
      type: "telemetry_sync",
      payload: {
        tenantId: "tenant-a",
        trustScore: 88,
        priorities: [],
        sanitized: true,
      },
    });

    expect(event).not.toBeNull();
    expect(event?.signatureAlgorithm).toBe("rsa-sha256");
    expect(event?.keyId).toBe("key-a");

    const ingested = await consumer.ingest(event as FederationEvent);
    expect(ingested).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports hybrid payload encryption and decryption (AES-256-GCM + RSA-OAEP)", async () => {
    const producerKeys = generateFederationKeyPair();
    const consumerKeys = generateFederationKeyPair();

    const producer = new FederationBus({
      tenantId: "tenant-a",
      privateKey: producerKeys.privateKey,
      publicKey: producerKeys.publicKey,
      peerPublicKeys: { "tenant-b": consumerKeys.publicKey },
      enabled: true,
    });

    const consumer = new FederationBus({
      tenantId: "tenant-b",
      privateKey: consumerKeys.privateKey,
      publicKey: consumerKeys.publicKey,
      peerPublicKeys: { "tenant-a": producerKeys.publicKey },
      enabled: true,
    });

    const listener = vi.fn();
    consumer.subscribe("telemetry_sync", listener);

    const { event } = await producer.publish({
      type: "telemetry_sync",
      recipientPublicKey: consumerKeys.publicKey,
      payload: {
        tenantId: "tenant-a",
        trustScore: 95,
        priorities: [],
        sanitized: true,
      },
    });

    expect(event).not.toBeNull();
    expect(event?.encryptedPayload).toBeDefined();
    expect(event?.encryptedKey).toBeDefined();
    expect(event?.iv).toBeDefined();
    expect(event?.payload).toBeUndefined();

    const ingested = await consumer.ingest(event as FederationEvent);
    expect(ingested).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].payload).toEqual({
      tenantId: "tenant-a",
      trustScore: 95,
      priorities: [],
      sanitized: true,
    });
  });

  it("rejects tampered asymmetric signatures", async () => {
    const producerKeys = generateFederationKeyPair();
    const consumerKeys = generateFederationKeyPair();

    const producer = new FederationBus({
      tenantId: "tenant-a",
      privateKey: producerKeys.privateKey,
      publicKey: producerKeys.publicKey,
      peerPublicKeys: { "tenant-b": consumerKeys.publicKey },
      enabled: true,
    });

    const consumer = new FederationBus({
      tenantId: "tenant-b",
      privateKey: consumerKeys.privateKey,
      publicKey: consumerKeys.publicKey,
      peerPublicKeys: { "tenant-a": producerKeys.publicKey },
      enabled: true,
    });

    const { event } = await producer.publish({
      type: "telemetry_sync",
      payload: {
        tenantId: "tenant-a",
        trustScore: 90,
        priorities: [],
        sanitized: true,
      },
    });

    const tamperedEvent = {
      ...(event as FederationEvent),
      signature: "00".repeat(128),
    };

    await expect(consumer.ingest(tamperedEvent)).rejects.toThrow(/Invalid federation signature/);
  });

  it("rejects corrupted ciphertext or auth tag during decryption", async () => {
    const producerKeys = generateFederationKeyPair();
    const consumerKeys = generateFederationKeyPair();

    const producer = new FederationBus({
      tenantId: "tenant-a",
      privateKey: producerKeys.privateKey,
      publicKey: producerKeys.publicKey,
      peerPublicKeys: { "tenant-b": consumerKeys.publicKey },
      enabled: true,
    });

    const consumer = new FederationBus({
      tenantId: "tenant-b",
      privateKey: consumerKeys.privateKey,
      publicKey: consumerKeys.publicKey,
      peerPublicKeys: { "tenant-a": producerKeys.publicKey },
      enabled: true,
    });

    const { event } = await producer.publish({
      type: "telemetry_sync",
      recipientPublicKey: consumerKeys.publicKey,
      payload: {
        tenantId: "tenant-a",
        trustScore: 90,
        priorities: [],
        sanitized: true,
      },
    });

    // Corrupt payload buffer but re-sign so signature verification passes
    const corruptedPayload = Buffer.from(event!.encryptedPayload!, "base64");
    corruptedPayload[0] ^= 0xff; // flip bits
    const corruptedPayloadBase64 = corruptedPayload.toString("base64");

    const corruptedEvent: FederationEvent = {
      ...(event as FederationEvent),
      encryptedPayload: corruptedPayloadBase64,
    };

    // Re-sign with producer key over corrupted event fields
    const signableString = JSON.stringify({
      type: corruptedEvent.type,
      tenantId: corruptedEvent.tenantId,
      timestamp: corruptedEvent.timestamp,
      encryptedPayload: corruptedEvent.encryptedPayload,
      encryptedKey: corruptedEvent.encryptedKey,
      iv: corruptedEvent.iv,
    });

    const signer = (await import("node:crypto")).createSign("SHA256");
    signer.update(signableString);
    signer.end();
    corruptedEvent.signature = signer.sign(producerKeys.privateKey, "hex");

    await expect(consumer.ingest(corruptedEvent)).rejects.toThrow(/Payload decryption failed/);
  });

  it("handles missing private key when ingesting encrypted events", async () => {
    const producerKeys = generateFederationKeyPair();
    const consumerKeys = generateFederationKeyPair();

    const producer = new FederationBus({
      tenantId: "tenant-a",
      privateKey: producerKeys.privateKey,
      publicKey: producerKeys.publicKey,
      enabled: true,
    });

    // Consumer missing private key
    const consumer = new FederationBus({
      tenantId: "tenant-b",
      secret: "secret-key",
      peerPublicKeys: { "tenant-a": producerKeys.publicKey },
      enabled: true,
    });

    const { event } = await producer.publish({
      type: "telemetry_sync",
      recipientPublicKey: consumerKeys.publicKey,
      payload: {
        tenantId: "tenant-a",
        trustScore: 90,
        priorities: [],
        sanitized: true,
      },
    });

    await expect(consumer.ingest(event as FederationEvent)).rejects.toThrow(
      /Cannot decrypt event: Private key missing/,
    );
  });

  it("maintains backward-compatible HMAC fallback when asymmetric keys are absent", async () => {
    const producer = new FederationBus({ tenantId: "tenant-a", secret: "hmac-secret", enabled: true });
    const consumer = new FederationBus({ tenantId: "tenant-b", secret: "hmac-secret", enabled: true });

    const { event } = await producer.publish({
      type: "telemetry_sync",
      payload: {
        tenantId: "tenant-a",
        trustScore: 75,
        priorities: [],
        sanitized: true,
      },
    });

    expect(event?.signatureAlgorithm).toBe("hmac-sha256");
    const ingested = await consumer.ingest(event as FederationEvent);
    expect(ingested).toBe(true);
  });
});
