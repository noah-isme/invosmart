import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { FederationBus, generateFederationKeyPair } from "@/lib/federation/bus";
import { FederationAgent } from "@/lib/ai/federationAgent";
import type { FederationEvent } from "@/lib/federation/protocol";

describe("Empirical Challenge Suite — Milestone M3 Encryption & Bus Stress", () => {
  // 1. RSA Key Generation Throughput & Validity
  it("EMPIRICAL: RSA Key Generation Benchmark & Verification", () => {
    const start = performance.now();
    const count = 10;
    for (let i = 0; i < count; i++) {
      const keys = generateFederationKeyPair();
      expect(keys.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
      expect(keys.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    }
    const durationMs = performance.now() - start;
    const avgMs = durationMs / count;
    console.log(`[BENCHMARK] RSA Key Generation (2048-bit): ${avgMs.toFixed(2)} ms/keypair (${(1000 / avgMs).toFixed(1)} keypairs/sec)`);
    expect(avgMs).toBeLessThan(500); // Expect keypair generation to take < 500ms each
  });

  // 2. High-Frequency Signing & Verification Throughput Benchmark
  it("EMPIRICAL: Compare RSA vs HMAC Signing & Verification Throughput", async () => {
    const hmacBus = new FederationBus({ tenantId: "tenant-hmac", secret: "secret-123", enabled: true });
    const rsaKeys = generateFederationKeyPair();
    const rsaBusA = new FederationBus({
      tenantId: "tenant-rsa-a",
      privateKey: rsaKeys.privateKey,
      publicKey: rsaKeys.publicKey,
      enabled: true,
    });
    const rsaBusB = new FederationBus({
      tenantId: "tenant-rsa-b",
      publicKey: rsaKeys.publicKey,
      peerPublicKeys: { "tenant-rsa-a": rsaKeys.publicKey },
      enabled: true,
    });

    const N = 500;

    // HMAC benchmark
    const hmacStart = performance.now();
    for (let i = 0; i < N; i++) {
      const { event } = await hmacBus.publish({
        type: "telemetry_sync",
        payload: { tenantId: "tenant-hmac", trustScore: 80, priorities: [], sanitized: true },
      });
      await hmacBus.ingest(event as FederationEvent);
    }
    const hmacDuration = performance.now() - hmacStart;
    const hmacOpsPerSec = (N / hmacDuration) * 1000;
    console.log(`[BENCHMARK] HMAC-SHA256 end-to-end: ${N} ops in ${hmacDuration.toFixed(2)} ms (${hmacOpsPerSec.toFixed(1)} ops/sec)`);

    // RSA benchmark
    const rsaStart = performance.now();
    for (let i = 0; i < N; i++) {
      const { event } = await rsaBusA.publish({
        type: "telemetry_sync",
        payload: { tenantId: "tenant-rsa-a", trustScore: 80, priorities: [], sanitized: true },
      });
      await rsaBusB.ingest(event as FederationEvent);
    }
    const rsaDuration = performance.now() - rsaStart;
    const rsaOpsPerSec = (N / rsaDuration) * 1000;
    console.log(`[BENCHMARK] RSA-SHA256 end-to-end: ${N} ops in ${rsaDuration.toFixed(2)} ms (${rsaOpsPerSec.toFixed(1)} ops/sec)`);

    expect(hmacDuration).toBeGreaterThan(0);
    expect(rsaDuration).toBeGreaterThan(0);
  });

  // 3. Hybrid Payload Encryption (AES-256-GCM + RSA-OAEP) Throughput & Payload Scaling
  it("EMPIRICAL: Hybrid Encryption Throughput across small and large payloads", async () => {
    const producerKeys = generateFederationKeyPair();
    const consumerKeys = generateFederationKeyPair();

    const producer = new FederationBus({
      tenantId: "tenant-prod",
      privateKey: producerKeys.privateKey,
      publicKey: producerKeys.publicKey,
      peerPublicKeys: { "tenant-cons": consumerKeys.publicKey },
      enabled: true,
    });

    const consumer = new FederationBus({
      tenantId: "tenant-cons",
      privateKey: consumerKeys.privateKey,
      publicKey: consumerKeys.publicKey,
      peerPublicKeys: { "tenant-prod": producerKeys.publicKey },
      enabled: true,
    });

    let receivedPayload: any = null;
    consumer.subscribe("telemetry_sync", (evt) => {
      receivedPayload = evt.payload;
    });

    // Small payload test
    const smallStart = performance.now();
    for (let i = 0; i < 100; i++) {
      const { event } = await producer.publish({
        type: "telemetry_sync",
        recipientPublicKey: consumerKeys.publicKey,
        payload: { tenantId: "tenant-prod", trustScore: 88, priorities: [], sanitized: true },
      });
      expect(event?.encryptedPayload).toBeDefined();
      expect(event?.encryptedKey).toBeDefined();
      expect(event?.iv).toBeDefined();
      await consumer.ingest(event as FederationEvent);
      expect(receivedPayload.trustScore).toBe(88);
    }
    const smallDuration = performance.now() - smallStart;
    console.log(`[BENCHMARK] Hybrid Encryption (Small Payload, 100 ops): ${smallDuration.toFixed(2)} ms (${((100 / smallDuration) * 1000).toFixed(1)} ops/sec)`);

    // Large payload test (100KB payload with 1000 priority snapshots)
    const largePriorities = Array.from({ length: 1000 }, (_, idx) => ({
      agent: "optimizer" as const,
      weight: 0.85,
      confidence: 0.92,
      rationale: `Snapshot ${idx}: Extremely long rationale string testing memory alignment, serialization overhead, AES buffer allocation, and UTF-8 handling: ${"X".repeat(100)}`,
    }));

    const largeStart = performance.now();
    for (let i = 0; i < 20; i++) {
      const { event } = await producer.publish({
        type: "telemetry_sync",
        recipientPublicKey: consumerKeys.publicKey,
        payload: {
          tenantId: "tenant-prod",
          trustScore: 99,
          priorities: largePriorities,
          sanitized: true,
          insightSummary: "Summary ".repeat(500),
        },
      });
      expect(event?.encryptedPayload?.length).toBeGreaterThan(100000);
      await consumer.ingest(event as FederationEvent);
      expect(receivedPayload.priorities.length).toBe(1000);
    }
    const largeDuration = performance.now() - largeStart;
    console.log(`[BENCHMARK] Hybrid Encryption (Large 100KB Payload, 20 ops): ${largeDuration.toFixed(2)} ms (${((20 / largeDuration) * 1000).toFixed(1)} ops/sec)`);
  });

  // 4. High-Frequency Concurrent Message Delivery & EventEmitter Stress
  it("EMPIRICAL: Concurrent Burst Delivery (1000 parallel events)", async () => {
    const keysA = generateFederationKeyPair();
    const keysB = generateFederationKeyPair();

    const busA = new FederationBus({
      tenantId: "tenant-burst-a",
      privateKey: keysA.privateKey,
      publicKey: keysA.publicKey,
      peerPublicKeys: { "tenant-burst-b": keysB.publicKey },
      enabled: true,
    });

    const busB = new FederationBus({
      tenantId: "tenant-burst-b",
      privateKey: keysB.privateKey,
      publicKey: keysB.publicKey,
      peerPublicKeys: { "tenant-burst-a": keysA.publicKey },
      enabled: true,
    });

    let receivedCount = 0;
    busB.subscribe("telemetry_sync", () => {
      receivedCount++;
    });

    const BURST = 500;
    const pubPromises = Array.from({ length: BURST }, (_, idx) =>
      busA.publish({
        type: "telemetry_sync",
        payload: {
          tenantId: "tenant-burst-a",
          trustScore: idx % 100,
          priorities: [],
          sanitized: true,
        },
      }),
    );

    const pubResults = await Promise.all(pubPromises);
    expect(pubResults.length).toBe(BURST);

    const ingestPromises = pubResults.map((res) => busB.ingest(res.event as FederationEvent));
    const ingestResults = await Promise.all(ingestPromises);

    expect(ingestResults.filter(Boolean).length).toBe(BURST);
    expect(receivedCount).toBe(BURST);
    expect(busB.getRecentEvents().length).toBe(25); // Default recentLimit
  });

  // 5. Dynamic Key Distribution & Multi-Tenant Routing Stress
  it("EMPIRICAL: Multi-Tenant Key Distribution with 10 Tenants", async () => {
    const tenants: Record<string, { keys: { publicKey: string; privateKey: string }; bus: FederationBus }> = {};

    // Generate 10 tenant keypairs
    const tenantIds = Array.from({ length: 10 }, (_, i) => `tenant-${i + 1}`);
    const keyMap: Record<string, string> = {};

    const generated = tenantIds.map((id) => ({ id, keys: generateFederationKeyPair() }));
    for (const item of generated) {
      keyMap[item.id] = item.keys.publicKey;
    }

    for (const item of generated) {
      tenants[item.id] = {
        keys: item.keys,
        bus: new FederationBus({
          tenantId: item.id,
          privateKey: item.keys.privateKey,
          publicKey: item.keys.publicKey,
          peerPublicKeys: keyMap,
          enabled: true,
        }),
      };
    }

    // Every tenant sends an encrypted message to tenant-1
    const recipientKey = keyMap["tenant-1"];
    let tenant1Count = 0;
    tenants["tenant-1"].bus.subscribe("telemetry_sync", () => {
      tenant1Count++;
    });

    for (const id of tenantIds) {
      if (id === "tenant-1") continue;
      const { event } = await tenants[id].bus.publish({
        type: "telemetry_sync",
        recipientPublicKey: recipientKey,
        payload: { tenantId: id, trustScore: 75, priorities: [], sanitized: true },
      });
      const ingested = await tenants["tenant-1"].bus.ingest(event as FederationEvent);
      expect(ingested).toBe(true);
    }

    expect(tenant1Count).toBe(9);
  });

  // 6. Seamless HMAC Fallback Matrix
  it("EMPIRICAL: HMAC Fallback behavior when asymmetric keys are omitted or missing", async () => {
    // Producer has HMAC secret only, no RSA key
    const producerHMAC = new FederationBus({ tenantId: "prod-hmac", secret: "shared-secret", enabled: true });
    // Consumer has HMAC secret AND RSA keys
    const rsaKeys = generateFederationKeyPair();
    const consumerHybrid = new FederationBus({
      tenantId: "cons-hybrid",
      secret: "shared-secret",
      privateKey: rsaKeys.privateKey,
      publicKey: rsaKeys.publicKey,
      enabled: true,
    });

    const { event } = await producerHMAC.publish({
      type: "telemetry_sync",
      payload: { tenantId: "prod-hmac", trustScore: 80, priorities: [], sanitized: true },
    });

    expect(event?.signatureAlgorithm).toBe("hmac-sha256");
    const ingested = await consumerHybrid.ingest(event as FederationEvent);
    expect(ingested).toBe(true);
  });

  // 7. Security Edge Cases & Attack Vector Oracles
  it("EMPIRICAL: Security Oracles - Tampering, Bit Flips, Corrupted Keys & Invalid Auth Tags", async () => {
    const keysA = generateFederationKeyPair();
    const keysB = generateFederationKeyPair();

    const busA = new FederationBus({
      tenantId: "tenant-a",
      privateKey: keysA.privateKey,
      publicKey: keysA.publicKey,
      peerPublicKeys: { "tenant-b": keysB.publicKey },
      enabled: true,
    });

    const busB = new FederationBus({
      tenantId: "tenant-b",
      privateKey: keysB.privateKey,
      publicKey: keysB.publicKey,
      peerPublicKeys: { "tenant-a": keysA.publicKey },
      enabled: true,
    });

    const { event: validEncryptedEvent } = await busA.publish({
      type: "telemetry_sync",
      recipientPublicKey: keysB.publicKey,
      payload: { tenantId: "tenant-a", trustScore: 90, priorities: [], sanitized: true },
    });

    // Oracle 1: Tampered AES Ciphertext with valid signature
    const corruptPayload = Buffer.from(validEncryptedEvent!.encryptedPayload!, "base64");
    corruptPayload[5] ^= 0x01; // flip 1 bit in ciphertext
    const corruptPayloadBase64 = corruptPayload.toString("base64");

    const reSignedEvent = { ...validEncryptedEvent, encryptedPayload: corruptPayloadBase64 } as FederationEvent;
    // Re-sign over corrupted payload so verifySignature passes
    const signableString = JSON.stringify({
      type: reSignedEvent.type,
      tenantId: reSignedEvent.tenantId,
      timestamp: reSignedEvent.timestamp,
      encryptedPayload: reSignedEvent.encryptedPayload,
      encryptedKey: reSignedEvent.encryptedKey,
      iv: reSignedEvent.iv,
    });
    const signer = crypto.createSign("SHA256");
    signer.update(signableString);
    signer.end();
    reSignedEvent.signature = signer.sign(keysA.privateKey, "hex");

    await expect(busB.ingest(reSignedEvent)).rejects.toThrow(/Payload decryption failed/);

    // Oracle 2: Tampered Encrypted Symmetric Key (wrong RSA-OAEP unwrap)
    const corruptKey = Buffer.from(validEncryptedEvent!.encryptedKey!, "base64");
    corruptKey[10] ^= 0xff;
    const corruptKeyBase64 = corruptKey.toString("base64");
    const reSignedKeyEvent = { ...validEncryptedEvent, encryptedKey: corruptKeyBase64 } as FederationEvent;
    const signableString2 = JSON.stringify({
      type: reSignedKeyEvent.type,
      tenantId: reSignedKeyEvent.tenantId,
      timestamp: reSignedKeyEvent.timestamp,
      encryptedPayload: reSignedKeyEvent.encryptedPayload,
      encryptedKey: reSignedKeyEvent.encryptedKey,
      iv: reSignedKeyEvent.iv,
    });
    const signer2 = crypto.createSign("SHA256");
    signer2.update(signableString2);
    signer2.end();
    reSignedKeyEvent.signature = signer2.sign(keysA.privateKey, "hex");

    await expect(busB.ingest(reSignedKeyEvent)).rejects.toThrow(/Payload decryption failed/);

    // Oracle 3: Truncated Payload (less than 16-byte auth tag)
    const truncatedPayloadBase64 = Buffer.from("short").toString("base64");
    const reSignedShortEvent = { ...validEncryptedEvent, encryptedPayload: truncatedPayloadBase64 } as FederationEvent;
    const signableString3 = JSON.stringify({
      type: reSignedShortEvent.type,
      tenantId: reSignedShortEvent.tenantId,
      timestamp: reSignedShortEvent.timestamp,
      encryptedPayload: reSignedShortEvent.encryptedPayload,
      encryptedKey: reSignedShortEvent.encryptedKey,
      iv: reSignedShortEvent.iv,
    });
    const signer3 = crypto.createSign("SHA256");
    signer3.update(signableString3);
    signer3.end();
    reSignedShortEvent.signature = signer3.sign(keysA.privateKey, "hex");

    await expect(busB.ingest(reSignedShortEvent)).rejects.toThrow(/Corrupted encrypted payload: buffer too short/);

    // Oracle 4: Unknown tenant public key verification failure
    const unknownTenantEvent = {
      ...validEncryptedEvent,
      tenantId: "tenant-unknown",
    } as FederationEvent;
    await expect(busB.ingest(unknownTenantEvent)).rejects.toThrow(/Invalid federation signature/);
  });
});
