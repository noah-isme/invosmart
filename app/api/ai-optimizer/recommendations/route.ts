import { NextResponse } from "next/server";

import { getLatestRecommendations } from "@/lib/ai/optimizer";

export async function GET() {
  if (process.env.ENABLE_AI_OPTIMIZER === "false") {
    return NextResponse.json({ recommendations: [] });
  }

  const recommendations = await getLatestRecommendations({ limit: 20 });
  return NextResponse.json({ recommendations });
}
