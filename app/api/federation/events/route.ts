import { NextRequest, NextResponse } from "next/server";

import { getFederationAgent } from "@/lib/ai/federationAgent";
import { requireFederationBearer } from "@/lib/federation/auth";
import { federationBus } from "@/lib/federation/bus";
import { federationEventSchema } from "@/lib/federation/protocol";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Inbound federation events from peers (the target of FederationBus.deliver()).
 *
 * Authorisation is the peer bearer (FEDERATION_TOKEN_SECRET) plus the event
 * signature, both checked before any side effect; FederationBus.ingest() then
 * enforces the 5-minute freshness window and the FederationInboundEvent replay
 * guard. This route never reads the session or cookies, which is why it is on
 * the CSRF exemption list in lib/security/csrf.ts.
 */

export const maxDuration = 10;

const MAX_BODY_BYTES = 64 * 1024;

const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status });

const DECRYPT_ERROR = /^(Payload decryption failed|Corrupted encrypted payload|Cannot decrypt event)/;

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_AI_FEDERATION === "false" || !federationBus.isEnabled) {
    return json({ error: "Federation disabled" }, 503);
  }

  // Per-instance, per-IP; tunable if a busy peer needs more than 10/min.
  const limited = rateLimit(request, "federation-events");
  if (limited) return limited;

  const unauthorised = requireFederationBearer(request);
  if (unauthorised) return unauthorised;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: "Request body too large" }, 413);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: "Request body too large" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const parsed = federationEventSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid federation event" }, 400);
  }

  // Wire the FederationAgent's subscribers in this process before emitting.
  getFederationAgent();

  try {
    const accepted = await federationBus.ingest(parsed.data);
    return json({ accepted }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Invalid federation signature" || message === "Stale federation event") {
      return json({ error: message }, 401);
    }
    if (message === "Duplicate federation event") {
      return json({ accepted: false, duplicate: true }, 200);
    }
    if (DECRYPT_ERROR.test(message)) {
      return json({ error: "Invalid federation event" }, 400);
    }
    console.error("[federation] inbound event failed", { message });
    return json({ error: "Internal server error" }, 500);
  }
}
