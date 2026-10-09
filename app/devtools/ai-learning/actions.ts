"use server";

import { revalidatePath } from "next/cache";

import { runLearningCycle } from "@/lib/ai/learning";
import { assertPlatformAdminAction } from "@/lib/devtools/require-platform-admin";

export async function triggerLearningCycleAction() {
  await assertPlatformAdminAction();
  const result = await runLearningCycle();
  revalidatePath("/devtools/ai-learning");
  return result;
}
