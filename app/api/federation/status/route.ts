import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getFederationAgent } from "@/lib/ai/federationAgent";
import { federationBus } from "@/lib/federation/bus";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

const isAuthorised = async (request: Request) => {
  const secret = process.env.FEDERATION_TOKEN_SECRET;
  if (!secret) return true;

  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer")) return false;
  const token = header.slice("bearer".length).trim();
  if (token === secret) return true;

  const session = await getServerSession(authOptions);
  if (session && canViewPerfTools(session)) {
    return true;
  }

  return false;
};

export async function GET(request: Request) {
  if (!(await isAuthorised(request))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

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
  if (!(await isAuthorised(request))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

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
