import { NextResponse } from "next/server";

import { getLatestRecommendations } from "@/lib/ai/optimizer";

export async function GET() {
  if (process.env.ENABLE_AI_OPTIMIZER === "false") {
    return NextResponse.json({ recommendations: [] });
  }

  // Anonymous callers only need route + confidence for prefetching; the full
  // OptimizationLog entries (suggestions, actors, notes) are admin-only data.
  const entries = await getLatestRecommendations({ limit: 20 });
  const recommendations = entries.map(({ route, confidence }) => ({ route, confidence }));
  return NextResponse.json({ recommendations });
}
