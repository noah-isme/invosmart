import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recommendSchedule } from "@/lib/ai/scheduler";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";
import {
  canReadWorkspace,
  resolveWorkspaceContextForRequest,
} from "@/lib/workspaces";

const requestSchema = z.object({
  contentId: z.number().int(),
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
  if (!workspace || !canReadWorkspace(workspace) || !workspace.organizationId) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const recommendation = await recommendSchedule({
    organizationId: workspace.organizationId,
    contentId: parsed.data.contentId,
  });

  if (!recommendation) {
    return NextResponse.json({ error: "Tidak ada rekomendasi jadwal" }, { status: 404 });
  }

  return NextResponse.json({ recommendation });
}
