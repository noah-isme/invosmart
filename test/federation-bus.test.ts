import { describe, expect, it, vi, beforeEach } from "vitest";

import { FederationBus } from "@/lib/federation/bus";
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
});
