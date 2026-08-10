import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { FederationBus, generateFederationKeyPair } from "@/lib/federation/bus";
import type { FederationEvent } from "@/lib/federation/protocol";

describe("Empirical Challenge Suite — M3 Edge Cases & Cryptographic Boundary Tests", () => {
  it("EMPIRICAL: Malformed PEM Private Key handles initialization and errors gracefully", () => {
    const invalidPrivateKey = "-----BEGIN PRIVATE KEY-----\nINVALID_BASE64_DATA\n-----END PRIVATE KEY-----";
    const bus = new FederationBus({
      tenantId: "tenant-bad-key",
      privateKey: invalidPrivateKey,
      enabled: true,
    });

    // Attempting to publish should throw an error during sign()
    expect(
      bus.publish({
        type: "telemetry_sync",
        payload: { tenantId: "tenant-bad-key", trustScore: 70, priorities: [], sanitized: true },
      }),
    ).rejects.toThrow();
  });

  it("EMPIRICAL: Invalid IV hex format or invalid IV length in decryptPayload", async () => {
    const keysA = generateFederationKeyPair();
    const keysB = generateFederationKeyPair();

    const busA = new FederationBus({
      tenantId: "tenant-a",
      privateKey: keysA.privateKey,
      publicKey: keysA.publicKey,
      enabled: true,
    });

    const busB = new FederationBus({
      tenantId: "tenant-b",
      privateKey: keysB.privateKey,
      publicKey: keysB.publicKey,
      peerPublicKeys: { "tenant-a": keysA.publicKey },
      enabled: true,
    });

    const { event } = await busA.publish({
      type: "telemetry_sync",
      recipientPublicKey: keysB.publicKey,
      payload: { tenantId: "tenant-a", trustScore: 85, priorities: [], sanitized: true },
    });

    // Modify IV to invalid hex string or wrong byte size
    const badIvEvent = { ...event, iv: "1234" } as FederationEvent; // 2 bytes instead of 12
    const signableString = JSON.stringify({
      type: badIvEvent.type,
      tenantId: badIvEvent.tenantId,
      timestamp: badIvEvent.timestamp,
      encryptedPayload: badIvEvent.encryptedPayload,
      encryptedKey: badIvEvent.encryptedKey,
      iv: badIvEvent.iv,
    });

    const signer = crypto.createSign("SHA256");
    signer.update(signableString);
    signer.end();
    badIvEvent.signature = signer.sign(keysA.privateKey, "hex");

    await expect(busB.ingest(badIvEvent)).rejects.toThrow(/Payload decryption failed/);
  });

  it("EMPIRICAL: Event subscription unbind stop receiving events", async () => {
    const bus = new FederationBus({ tenantId: "tenant-unsub", secret: "sec", enabled: true });
    let count = 0;
    const unsub = bus.subscribe("telemetry_sync", () => {
      count++;
    });

    const { event: evt1 } = await bus.publish({
      type: "telemetry_sync",
      payload: { tenantId: "tenant-unsub", trustScore: 50, priorities: [], sanitized: true },
    });
    expect(count).toBe(1);

    unsub();

    const { event: evt2 } = await bus.publish({
      type: "telemetry_sync",
      payload: { tenantId: "tenant-unsub", trustScore: 60, priorities: [], sanitized: true },
    });
    expect(count).toBe(1); // Should remain 1 after unbind
  });
});
