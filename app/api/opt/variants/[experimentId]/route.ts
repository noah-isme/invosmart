import { NextRequest, NextResponse } from "next/server";

import { serializeExperimentSummary, summariseExperiment } from "@/lib/ai/content-local-optimizer";
import { requireAuthenticatedSession } from "@/app/api/opt/_shared";
import {
  canReadWorkspace,
  resolveWorkspaceContextForRequest,
} from "@/lib/workspaces";

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

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const workspace = await resolveWorkspaceContextForRequest(request, auth.session);
  if (!workspace || !canReadWorkspace(workspace) || !workspace.organizationId) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
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

  if (summary.experiment.organizationId !== workspace.organizationId) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  return NextResponse.json({ experiment: serializeExperimentSummary(summary) });
}
