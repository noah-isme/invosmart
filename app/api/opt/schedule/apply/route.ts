import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyScheduleRecommendation } from "@/lib/ai/scheduler";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";
import {
  canWriteWorkspace,
  resolveWorkspaceContextForRequest,
} from "@/lib/workspaces";

const requestSchema = z.object({
  contentId: z.number().int(),
  experimentId: z.number().int().optional(),
  variantId: z.number().int().optional(),
  recommendation: z.object({
    recommendedAt: z.string(),
    day: z.string(),
    hour: z.number().int(),
    confidence: z.number(),
    reason: z.string(),
    quotaRemaining: z.number(),
    limit: z.number(),
    autoEligible: z.boolean(),
    source: z.enum(["local", "global"]),
  }),
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
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await applyScheduleRecommendation({
    organizationId: workspace.organizationId,
    contentId: parsed.data.contentId,
    experimentId: parsed.data.experimentId,
    variantId: parsed.data.variantId,
    recommendation: parsed.data.recommendation,
  });

  return NextResponse.json(result);
}
