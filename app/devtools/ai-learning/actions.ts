"use server";

import { revalidatePath } from "next/cache";

import { runLearningCycle } from "@/lib/ai/learning";

export async function triggerLearningCycleAction() {
  const result = await runLearningCycle();
  revalidatePath("/devtools/ai-learning");
  return result;
}
