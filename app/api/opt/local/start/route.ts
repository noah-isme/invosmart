import { ExperimentAxis, ExperimentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  serializeExperimentSummary,
  startExperiment,
  variantPayloadSchema,
} from "@/lib/ai/content-local-optimizer";
import { ensureFeatureEnabled, requireAuthenticatedSession, respondFeatureDisabled } from "@/app/api/opt/_shared";

const requestSchema = z.object({
  organizationId: z.string().uuid().optional(),
  contentId: z.number().int(),
  axis: z.nativeEnum(ExperimentAxis),
  baseline: variantPayloadSchema,
  status: z.nativeEnum(ExperimentStatus).optional(),
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

  const summary = await startExperiment({
    organizationId: parsed.data.organizationId,
    contentId: parsed.data.contentId,
    axis: parsed.data.axis,
    baseline: parsed.data.baseline,
    status: parsed.data.status,
  });

  return NextResponse.json({ experiment: serializeExperimentSummary(summary) });
}
