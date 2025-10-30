"use server";

import { OptimizationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { guardrails, updateOptimizationStatus } from "@/lib/ai/optimizer";
import { isGovernanceEnabled } from "@/lib/ai/policy";

export async function applyRecommendationAction(id: string, actor: string) {
  const updated = await updateOptimizationStatus(id, OptimizationStatus.APPLIED, {
    actor,
    notes: "Applied via AI tuning dashboard",
  });

  if (!guardrails.isNonCriticalRoute(updated.route) && !isGovernanceEnabled()) {
    throw new Error("Attempted to apply optimization to critical route");
  }

  revalidatePath("/devtools/ai-tuning");
  return updated;
}

export async function rejectRecommendationAction(id: string, actor: string) {
  const updated = await updateOptimizationStatus(id, OptimizationStatus.REJECTED, {
    actor,
    notes: "Rejected via AI tuning dashboard",
  });

  revalidatePath("/devtools/ai-tuning");
  return updated;
}
