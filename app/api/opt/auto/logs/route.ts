import { AutoActionType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { serializeAutoAction } from "@/lib/ai/approval-gates";
import { db } from "@/lib/db";
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
  const actionTypeParam = search.get("actionType");
  const limitParam = search.get("limit");
  const cursorParam = search.get("cursor");

  const actionType = actionTypeParam && actionTypeParam in AutoActionType ? (actionTypeParam as AutoActionType) : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 25;

  const actions = await db.aiAutoAction.findMany({
    where: {
      organizationId: workspace.organizationId,
      ...(actionType ? { actionType } : {}),
      ...(cursorParam ? { id: { lt: Number.parseInt(cursorParam, 10) } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit,
  });

  return NextResponse.json({
    actions: actions.map((action) => serializeAutoAction(action)),
  });
}
