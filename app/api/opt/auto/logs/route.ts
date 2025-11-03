import { AutoActionType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { serializeAutoAction } from "@/lib/ai/approval-gates";
import { db } from "@/lib/db";
import { requireAuthenticatedSession } from "@/app/api/opt/_shared";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const url = request.nextUrl ?? new URL(request.url);
  const search = url?.searchParams ?? new URLSearchParams();
  const organizationId = search.get("organizationId") ?? undefined;
  const actionTypeParam = search.get("actionType");
  const limitParam = search.get("limit");
  const cursorParam = search.get("cursor");

  const actionType = actionTypeParam && actionTypeParam in AutoActionType ? (actionTypeParam as AutoActionType) : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 25;

  const actions = await db.aiAutoAction.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
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
