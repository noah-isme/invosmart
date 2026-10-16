import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { FederationEvent } from "@/lib/federation/protocol";

const { BEARER, HMAC_KEY } = vi.hoisted(() => ({
  BEARER: "fed-bearer-route-0123456789",
  HMAC_KEY: "fed-hmac-route-key",
}));

const mocks = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = [];
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (rows.some((row) => row.signatureHash === data.signatureHash)) {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    }
    rows.push(data);
    return data;
  });
  return { rows, create, handler: vi.fn(), getServerSession: vi.fn(), state: { wired: false } };
});

vi.mock("@/lib/db", () => ({ db: { federationInboundEvent: { create: mocks.create } } }));
// The route must never look at the session.
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));

// A real bus with RSA keys for "peer-rsa" and the shared HMAC key; the
// singleton the route imports is replaced by it.
const keys = vi.hoisted(() => ({}) as { peer: { publicKey: string; privateKey: string } });
vi.mock("@/lib/federation/bus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/federation/bus")>();
  keys.peer = actual.generateFederationKeyPair();
  return {
    ...actual,
    federationBus: new actual.FederationBus({
      tenantId: "local",
      secret: BEARER,
      hmacSecret: HMAC_KEY,
      peerPublicKeys: { "peer-rsa": keys.peer.publicKey },
      enabled: true,
    }),
  };
});

// Stand-in for the FederationAgent: subscribing once is what wires handlers.
vi.mock("@/lib/ai/federationAgent", async () => {
  const { federationBus } = await import("@/lib/federation/bus");
  return {
    getFederationAgent: () => {
      if (!mocks.state.wired) {
        mocks.state.wired = true;
        federationBus.subscribe("telemetry_sync", mocks.handler);
      }
      return {};
    },
  };
});

import { POST } from "@/app/api/federation/events/route";
import { FederationBus } from "@/lib/federation/bus";
import { clearRateLimiters } from "@/lib/rate-limit";

let ipCounter = 0;

const post = (body: unknown, init: { bearer?: string | null; ip?: string; raw?: boolean } = {}) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": init.ip ?? `10.0.0.${++ipCounter % 250}`,
  };
  if (init.bearer !== null) headers.authorization = `Bearer ${init.bearer ?? BEARER}`;
  return POST(
    new NextRequest("http://localhost/api/federation/events", {
      method: "POST",
      headers,
      body: init.raw ? (body as string) : JSON.stringify(body),
    }),
  );
};

const payload = (tenantId: string) => ({ tenantId, trustScore: 80, priorities: [], sanitized: true });

const rsaEvent = async () => {
  const producer = new FederationBus({ tenantId: "peer-rsa", privateKey: keys.peer.privateKey, enabled: true });
  return (await producer.publish({ type: "telemetry_sync", payload: payload("peer-rsa") })).event as FederationEvent;
};

const hmacEvent = async (key = HMAC_KEY, timestamp?: string) => {
  const producer = new FederationBus({ tenantId: "peer-hmac", hmacSecret: key, enabled: true });
  return (await producer.publish({ type: "telemetry_sync", payload: payload("peer-hmac"), timestamp }))
    .event as FederationEvent;
};

describe("POST /api/federation/events", () => {
  beforeEach(() => {
    mocks.rows.length = 0;
    mocks.create.mockClear();
    mocks.handler.mockClear();
    mocks.getServerSession.mockReset();
    clearRateLimiters();
    vi.stubEnv("FEDERATION_TOKEN_SECRET", BEARER);
    vi.stubEnv("ENABLE_AI_FEDERATION", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid RSA-signed event: 202, one row, the agent handler runs once", async () => {
    const res = await post(await rsaEvent());

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.rows[0]).toMatchObject({ tenantId: "peer-rsa", signatureAlgorithm: "rsa-sha256", accepted: true });
    expect(mocks.handler).toHaveBeenCalledTimes(1);
    expect(mocks.getServerSession).not.toHaveBeenCalled();
  });

  it("accepts a valid HMAC event from a tenant without a registered public key", async () => {
    const res = await post(await hmacEvent());

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an HMAC event signed with the bearer token: 401, no write", async () => {
    const res = await post(await hmacEvent(BEARER));

    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("rejects an HMAC event claiming a tenant that has a registered RSA key", async () => {
    const event = await hmacEvent();
    const forged = { ...event, tenantId: "peer-rsa", payload: payload("peer-rsa") };
    const signable = JSON.stringify({
      type: forged.type,
      tenantId: forged.tenantId,
      timestamp: forged.timestamp,
      payload: forged.payload,
    });
    forged.signature = createHmac("sha256", HMAC_KEY).update(signable).digest("hex");

    const res = await post(forged);
    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a tampered payload: 401", async () => {
    const event = await rsaEvent();
    const res = await post({ ...event, payload: { ...payload("peer-rsa"), trustScore: 1 } });

    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a stale event: 401", async () => {
    const res = await post(await hmacEvent(HMAC_KEY, new Date(Date.now() - 6 * 60 * 1000).toISOString()));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Stale federation event" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("answers a replay with 200 duplicate:true and does not emit it again", async () => {
    const event = await rsaEvent();
    expect((await post(event)).status).toBe(202);

    const res = await post({ ...event, id: "replayed-with-new-id" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: false, duplicate: true });
    expect(mocks.handler).toHaveBeenCalledTimes(1);
  });

  it("returns 202 accepted:false for an echo of this instance's own event", async () => {
    const own = new FederationBus({ tenantId: "local", hmacSecret: HMAC_KEY, enabled: true });
    const { event } = await own.publish({ type: "telemetry_sync", payload: payload("local") });

    const res = await post(event);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: false });
    expect(mocks.rows[0]).toMatchObject({ accepted: false });
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer: 401 before any parsing", async () => {
    const event = await rsaEvent();

    expect((await post(event, { bearer: null })).status).toBe(401);
    expect((await post(event, { bearer: "wrong" })).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a 70 KB body with 413", async () => {
    const res = await post(JSON.stringify({ filler: "x".repeat(70 * 1024) }), { raw: true });
    expect(res.status).toBe(413);
  });

  it("rejects garbage and schema-invalid bodies with 400 without echoing them", async () => {
    const garbage = await post("{not json<script>", { raw: true });
    expect(garbage.status).toBe(400);
    expect(JSON.stringify(await garbage.json())).not.toContain("script");

    const invalid = await post({ id: "x", type: "telemetry_sync" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid federation event" });
  });

  it("returns 503 when federation is disabled", async () => {
    vi.stubEnv("ENABLE_AI_FEDERATION", "false");
    const res = await post(await rsaEvent());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Federation disabled" });
  });

  it("rate-limits the 11th request per IP per minute with 429", async () => {
    const event = await rsaEvent();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await post(event, { ip: "203.0.113.7", bearer: "wrong" })).status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
