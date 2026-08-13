import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateVariant, serializeExperimentSummary } from "@/lib/ai/content-local-optimizer";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";
import { db } from "@/lib/db";
import { canWriteWorkspace, resolveWorkspaceContextForRequest } from "@/lib/workspaces";

const requestSchema = z.object({
  experimentId: z.number().int(),
  tone: z.enum(["bold", "curious", "urgent"]).optional(),
  targetMetric: z.enum(["ctr", "conversions", "dwell"]).optional(),
  globalSignal: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const featureEnabled = ensureFeatureEnabled(process.env.ENABLE_AI_OPTIMIZER_LOCAL ?? process.env.ENABLE_AI_OPTIMIZER);
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
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const experiment = await db.contentExperiment.findFirst({
    where: { id: parsed.data.experimentId, organizationId: workspace.organizationId },
    select: { id: true },
  });
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const summary = await generateVariant({
    experimentId: parsed.data.experimentId,
    organizationId: workspace.organizationId,
    tone: parsed.data.tone,
    targetMetric: parsed.data.targetMetric,
    globalSignal: parsed.data.globalSignal,
  });

  return NextResponse.json({ experiment: serializeExperimentSummary(summary) });
}
