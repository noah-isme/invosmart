import { NextResponse } from "next/server";

import { serializeExperimentSummary, summariseExperiment } from "@/lib/ai/content-local-optimizer";
import { requireAuthenticatedSession } from "@/app/api/opt/_shared";

type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

const resolveExperimentId = async (params: RouteContext["params"]) => {
  const resolved = await params;
  const value = resolved?.experimentId;

  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const experimentIdParam = await resolveExperimentId(context.params);
  if (!experimentIdParam) {
    return NextResponse.json({ error: "Invalid experiment id" }, { status: 400 });
  }

  const experimentId = Number.parseInt(experimentIdParam, 10);
  if (Number.isNaN(experimentId)) {
    return NextResponse.json({ error: "Invalid experiment id" }, { status: 400 });
  }

  const summary = await summariseExperiment(experimentId);
  if (!summary) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  return NextResponse.json({ experiment: serializeExperimentSummary(summary) });
}
