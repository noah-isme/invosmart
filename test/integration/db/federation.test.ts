// FED-INT-01: a peer event posted to /api/federation/events is verified and
// recorded in FederationInboundEvent; the same signed event sent again (also
// with a new, unsigned id) is answered as a duplicate and not recorded twice.
// FED-INT-02: an HMAC event keyed with the bearer token is refused before any
// row is written.
// @covers: /api/federation/events (route handler called in-process; scripts/e2e-coverage-check.mjs)
import { afterAll, describe, expect, it, vi } from "vitest";

import { db, request, uid } from "./harness/fixtures";

// The integration env turns federation off; the bus singleton reads its config
// at module load, so switch it on before the route module is imported.
const env = vi.hoisted(() => {
  const keys = [
    "ENABLE_AI_FEDERATION",
    "ENABLE_AI_ORCHESTRATION",
    "FEDERATION_TOKEN_SECRET",
    "FEDERATION_HMAC_SECRET",
    "FEDERATION_TENANT_ID",
    "FEDERATION_ENDPOINTS",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const values = {
    ENABLE_AI_FEDERATION: "true",
    // Keep the agent's follow-up work off the orchestrator stream.
    ENABLE_AI_ORCHESTRATION: "false",
    FEDERATION_TOKEN_SECRET: "int-federation-bearer-0123456789",
    FEDERATION_HMAC_SECRET: "int-federation-hmac-key",
    FEDERATION_TENANT_ID: "int-local",
    FEDERATION_ENDPOINTS: "",
  };
  Object.assign(process.env, values);
  return { keys, previous, values };
});

import { POST as federationEvents } from "@/app/api/federation/events/route";
import { FederationBus } from "@/lib/federation/bus";
import type { FederationEvent } from "@/lib/federation/protocol";

afterAll(() => {
  for (const key of env.keys) {
    const value = env.previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const post = (event: unknown, bearer = env.values.FEDERATION_TOKEN_SECRET) =>
  federationEvents(
    request("/api/federation/events", {
      method: "POST",
      body: event,
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );

const peerEvent = async (tenantId: string, hmacSecret = env.values.FEDERATION_HMAC_SECRET) => {
  const peer = new FederationBus({ tenantId, hmacSecret, enabled: true, endpoints: [] });
  const { event } = await peer.publish({
    type: "telemetry_sync",
    // Non-empty priorities: the FederationAgent's follow-up priority_share
    // publish requires at least one entry.
    payload: {
      tenantId,
      trustScore: 77,
      priorities: [{ agent: "optimizer", weight: 0.5, confidence: 0.8, rationale: "integration" }],
      sanitized: true,
    },
  });
  return event as FederationEvent;
};

describe("FED-INT-01 inbound federation events are recorded once", () => {
  it("records a verified peer event and rejects its replay, also with a new id", async () => {
    const tenantId = `int-peer-${uid()}`;
    const event = await peerEvent(tenantId);

    const first = await post(event);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: true });

    const rows = await db.federationInboundEvent.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: event.id,
      type: "telemetry_sync",
      signatureAlgorithm: "hmac-sha256",
      accepted: true,
    });
    expect(rows[0].signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].eventTimestamp.toISOString()).toBe(new Date(event.timestamp).toISOString());

    const replay = await post(event);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ accepted: false, duplicate: true });

    const renamed = await post({ ...event, id: `replayed-${uid()}` });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ accepted: false, duplicate: true });

    expect(await db.federationInboundEvent.count({ where: { tenantId } })).toBe(1);
  });
});

describe("FED-INT-02 forged events never reach the database", () => {
  it("refuses an HMAC event keyed with the bearer token and writes nothing", async () => {
    const tenantId = `int-forger-${uid()}`;
    const forged = await peerEvent(tenantId, env.values.FEDERATION_TOKEN_SECRET);

    const res = await post(forged);
    expect(res.status).toBe(401);
    expect(await db.federationInboundEvent.count({ where: { tenantId } })).toBe(0);
  });

  it("refuses a request without the peer bearer", async () => {
    const tenantId = `int-nobearer-${uid()}`;
    const res = await post(await peerEvent(tenantId), "wrong-bearer");

    expect(res.status).toBe(401);
    expect(await db.federationInboundEvent.count({ where: { tenantId } })).toBe(0);
  });
});
