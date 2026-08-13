import { ExperimentAxis } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getLatestGlobalSignals, trainGlobalSignals } from "@/lib/ai/content-global-optimizer";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";
import {
  canWriteWorkspace,
  resolveWorkspaceContextForRequest,
} from "@/lib/workspaces";

const requestSchema = z.object({
  axis: z.nativeEnum(ExperimentAxis).optional(),
});

export async function POST(request: NextRequest) {
  const featureEnabled = ensureFeatureEnabled(process.env.ENABLE_AI_OPTIMIZER_GLOBAL ?? process.env.ENABLE_AI_OPTIMIZER);
  if (!featureEnabled) {
    return respondFeatureDisabled();
  }

  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const workspace = await resolveWorkspaceContextForRequest(request, auth.session);
  if (!workspace || !canWriteWorkspace(workspace) || !workspace.organizationId) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  await trainGlobalSignals({ organizationId: workspace.organizationId });
  const signals = await getLatestGlobalSignals({
    organizationId: workspace.organizationId,
    axis: parsed.data.axis,
  });

  return NextResponse.json({ signals });
}
