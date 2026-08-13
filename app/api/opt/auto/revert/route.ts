import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { markAutoActionReverted, serializeAutoAction } from "@/lib/ai/approval-gates";
import { requireAuthenticatedSession } from "@/app/api/opt/_shared";
import { db } from "@/lib/db";
import { canWriteWorkspace, resolveWorkspaceContextForRequest } from "@/lib/workspaces";

const requestSchema = z.object({
  actionId: z.number().int(),
  reason: z.string().optional(),
});

export async function POST(request: NextRequest) {
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

  const action = await db.aiAutoAction.findFirst({
    where: { id: parsed.data.actionId, organizationId: workspace.organizationId },
  });
  if (!action) {
    return NextResponse.json({ error: "Auto action not found" }, { status: 404 });
  }

  const reverted = await markAutoActionReverted({
    actionId: parsed.data.actionId,
    organizationId: workspace.organizationId,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ action: serializeAutoAction(reverted) });
}
