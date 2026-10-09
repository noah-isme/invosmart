import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getFederationAgent } from "@/lib/ai/federationAgent";
import { federationBus } from "@/lib/federation/bus";
import { isPlatformAdmin } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

// Hash both sides so the buffers always have equal length (timingSafeEqual
// throws otherwise) and the comparison does not leak the secret's length.
const bearerMatchesSecret = (header: string, secret: string) => {
  if (!/^bearer\s/i.test(header)) return false;
  const token = header.slice("bearer".length).trim();
  if (!token) return false;
  return timingSafeEqual(sha256(token), sha256(secret));
};

let warnedMissingSecret = false;

// Peers authenticate with the shared FEDERATION_TOKEN_SECRET as a bearer token;
// DevTools users authenticate with a platform-admin session. When no secret is
// configured the bearer path is disabled (fail closed), never open.
const authorise = async (request: Request): Promise<"ok" | "unauthenticated" | "forbidden"> => {
  const secret = process.env.FEDERATION_TOKEN_SECRET?.trim();

  if (!secret) {
    if (!warnedMissingSecret && process.env.NODE_ENV === "production") {
      warnedMissingSecret = true;
      console.warn(
        "[security] FEDERATION_TOKEN_SECRET is not set: /api/federation/status only accepts platform-admin sessions and peer bearer auth is disabled.",
      );
    }
  } else if (bearerMatchesSecret(request.headers.get("authorization") ?? "", secret)) {
    return "ok";
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return "unauthenticated";
  return isPlatformAdmin(session) ? "ok" : "forbidden";
};

const deny = (outcome: "unauthenticated" | "forbidden") =>
  outcome === "forbidden"
    ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
    : NextResponse.json({ error: "Unauthorised" }, { status: 401 });

export async function GET(request: Request) {
  const outcome = await authorise(request);
  if (outcome !== "ok") return deny(outcome);

  if (federationBus.isEnabled) {
    await federationBus.checkConnections();
  }

  const agent = getFederationAgent();
  const status = federationBus.getStatus();

  return NextResponse.json(
    {
      status,
      snapshots: agent.getSnapshots(),
      trustHistory: agent.getTrustHistory(),
      modelHistory: agent.getModelHistory(),
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: Request) {
  const outcome = await authorise(request);
  if (outcome !== "ok") return deny(outcome);

  const agent = getFederationAgent();
  await agent.broadcastLocalSnapshot();

  const status = federationBus.getStatus();

  return NextResponse.json(
    {
      status,
      snapshots: agent.getSnapshots(),
      trustHistory: agent.getTrustHistory(),
      modelHistory: agent.getModelHistory(),
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
