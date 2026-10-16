import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getFederationAgent } from "@/lib/ai/federationAgent";
import { requireFederationBearer } from "@/lib/federation/auth";
import { federationBus } from "@/lib/federation/bus";
import { isPlatformAdmin } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

// Peers authenticate with the shared FEDERATION_TOKEN_SECRET as a bearer token
// (requireFederationBearer, fail closed); DevTools users authenticate with a
// platform-admin session, checked only when the bearer does not match.
const authorise = async (request: Request): Promise<"ok" | "unauthenticated" | "forbidden"> => {
  if (requireFederationBearer(request) === null) return "ok";

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
