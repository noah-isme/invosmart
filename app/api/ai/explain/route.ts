import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { generateExplanationForRecommendation } from "@/lib/ai/explain";
import { isGovernanceEnabled } from "@/lib/ai/policy";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { captureServerEvent } from "@/lib/server-telemetry";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";

const RequestSchema = z.object({
  recommendation_id: z.string().min(1),
});

const explainRecommendation = async (request: NextRequest) => {
  if (!isGovernanceEnabled()) {
    return NextResponse.json({ error: "AI governance layer disabled" }, { status: 503 });
  }

  const httpsResult = enforceHttps(request);
  if (httpsResult) {
    return httpsResult;
  }

  const limited = rateLimit(request, "ai-explain");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "recommendation_id wajib diisi" }, { status: 400 });
  }

  try {
    const explanation = await generateExplanationForRecommendation(parsed.data.recommendation_id, session.user.email ?? "admin");
    void captureServerEvent("ai_explanation_generated", {
      recommendationId: explanation.recommendationId,
      actor: session.user.email ?? session.user.id,
    });

    return NextResponse.json({ data: explanation }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
};

export const POST = withTiming(explainRecommendation);
