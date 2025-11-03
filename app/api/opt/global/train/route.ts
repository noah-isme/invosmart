import { ExperimentAxis } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getLatestGlobalSignals, trainGlobalSignals } from "@/lib/ai/content-global-optimizer";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";

const requestSchema = z.object({
  organizationId: z.string().uuid().optional(),
  axis: z.nativeEnum(ExperimentAxis).optional(),
});

export async function POST(request: Request) {
  const featureEnabled = ensureFeatureEnabled(process.env.ENABLE_AI_OPTIMIZER_GLOBAL ?? process.env.ENABLE_AI_OPTIMIZER);
  if (!featureEnabled) {
    return respondFeatureDisabled();
  }

  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  await trainGlobalSignals({ organizationId: parsed.data.organizationId });
  const signals = await getLatestGlobalSignals({
    organizationId: parsed.data.organizationId,
    axis: parsed.data.axis,
  });

  return NextResponse.json({ signals });
}
