import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { chooseWinner, serializeExperimentSummary } from "@/lib/ai/content-local-optimizer";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";
import { db } from "@/lib/db";
import { canWriteWorkspace, resolveWorkspaceContextForRequest } from "@/lib/workspaces";

const requestSchema = z.object({
  experimentId: z.number().int(),
  variantId: z.number().int(),
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
  });
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const variant = await db.contentVariant.findFirst({
    where: { id: parsed.data.variantId, experimentId: parsed.data.experimentId },
    select: { id: true },
  });
  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  const summary = await chooseWinner({
    experimentId: parsed.data.experimentId,
    variantId: parsed.data.variantId,
    organizationId: workspace.organizationId,
  });

  return NextResponse.json({ experiment: serializeExperimentSummary(summary) });
}
