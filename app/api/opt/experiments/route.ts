import { ExperimentAxis, ExperimentStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { listExperiments, serializeExperimentSummary } from "@/lib/ai/content-local-optimizer";
import { requireAuthenticatedSession } from "@/app/api/opt/_shared";
import {
  canReadWorkspace,
  resolveWorkspaceContextForRequest,
} from "@/lib/workspaces";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const workspace = await resolveWorkspaceContextForRequest(request, auth.session);
  if (!workspace || !canReadWorkspace(workspace) || !workspace.organizationId) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const url = request.nextUrl ?? new URL(request.url);
  const search = url?.searchParams ?? new URLSearchParams();
  const axisParam = search.get("axis");
  const statusParam = search.get("status");
  const limitParam = search.get("limit");

  const axis = axisParam && axisParam in ExperimentAxis ? (axisParam as ExperimentAxis) : undefined;
  const status = statusParam && statusParam in ExperimentStatus ? (statusParam as ExperimentStatus) : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const experiments = await listExperiments({
    organizationId: workspace.organizationId,
    axis,
    status,
    limit,
  });

  return NextResponse.json({ experiments: experiments.map((item) => serializeExperimentSummary(item)) });
}
