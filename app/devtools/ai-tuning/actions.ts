"use server";

import { OptimizationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { guardrails, updateOptimizationStatus } from "@/lib/ai/optimizer";
import { isGovernanceEnabled } from "@/lib/ai/policy";
import { assertPlatformAdminAction } from "@/lib/devtools/require-platform-admin";

export async function applyRecommendationAction(id: string) {
  const session = await assertPlatformAdminAction();
  const updated = await updateOptimizationStatus(id, OptimizationStatus.APPLIED, {
    // Never trust a client-supplied actor: audit rows record the session user id.
    actor: session.user.id,
    notes: "Applied via AI tuning dashboard",
  });

  if (!guardrails.isNonCriticalRoute(updated.route) && !isGovernanceEnabled()) {
    throw new Error("Attempted to apply optimization to critical route");
  }

  revalidatePath("/devtools/ai-tuning");
  return updated;
}

export async function rejectRecommendationAction(id: string) {
  const session = await assertPlatformAdminAction();
  const updated = await updateOptimizationStatus(id, OptimizationStatus.REJECTED, {
    // Never trust a client-supplied actor: audit rows record the session user id.
    actor: session.user.id,
    notes: "Rejected via AI tuning dashboard",
  });

  revalidatePath("/devtools/ai-tuning");
  return updated;
}
