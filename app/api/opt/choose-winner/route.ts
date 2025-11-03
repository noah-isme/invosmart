import { NextResponse } from "next/server";
import { z } from "zod";

import { chooseWinner, serializeExperimentSummary } from "@/lib/ai/content-local-optimizer";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";

const requestSchema = z.object({
  experimentId: z.number().int(),
  variantId: z.number().int(),
});

export async function POST(request: Request) {
  const featureEnabled = ensureFeatureEnabled(process.env.ENABLE_AI_OPTIMIZER_LOCAL ?? process.env.ENABLE_AI_OPTIMIZER);
  if (!featureEnabled) {
    return respondFeatureDisabled();
  }

  const auth = await requireAuthenticatedSession();
  if (!auth.session) {
    return auth.response;
  }

  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const summary = await chooseWinner({
    experimentId: parsed.data.experimentId,
    variantId: parsed.data.variantId,
  });

  return NextResponse.json({ experiment: serializeExperimentSummary(summary) });
}
