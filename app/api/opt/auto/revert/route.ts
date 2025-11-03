import { NextResponse } from "next/server";
import { z } from "zod";

import { markAutoActionReverted, serializeAutoAction } from "@/lib/ai/approval-gates";
import { requireAuthenticatedSession } from "@/app/api/opt/_shared";

const requestSchema = z.object({
  actionId: z.number().int(),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const action = await markAutoActionReverted({
    actionId: parsed.data.actionId,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ action: serializeAutoAction(action) });
}
