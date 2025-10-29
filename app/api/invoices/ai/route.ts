import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createClient, DEFAULT_MODEL } from "@/lib/ai";
import { z } from "zod";

import { AIInvoiceSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { captureServerEvent } from "@/lib/server-telemetry";
import { withSpan } from "@/lib/tracing";

const systemPrompt = `
You are an invoice generation assistant.
Given a user instruction, return a JSON object with this structure:
{
  "client": string,
  "items": [{"name": string, "qty": number, "price": number}],
  "dueAt": string (ISO 8601) or null,
  "notes": string (optional)
}
Only respond with JSON.
`;

const requestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
});

const fallbackDraft = {
  client: "",
  items: [{ name: "", qty: 1, price: 0 }],
  notes: "",
} as const;

const extractJson = (content: string) => {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || firstBrace > lastBrace) {
    throw new Error("No JSON object found in AI response");
  }

  return content.slice(firstBrace, lastBrace + 1);
};

// Use createClient from lib/ai which prefers Gemini when configured.

const generateInvoiceDraft = async (request: NextRequest) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "invoices");
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
    return NextResponse.json(
      { error: "Request body invalid", fallback: fallbackDraft },
      { status: 400 },
    );
  }

  const parsedPrompt = requestSchema.safeParse(payload);

  if (!parsedPrompt.success) {
    return NextResponse.json(
      { error: "Prompt tidak valid", fallback: fallbackDraft },
      { status: 400 },
    );
  }

  try {
    const client = createClient();

    const aiRes = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: parsedPrompt.data.prompt },
      ],
      temperature: 0.3,
    });

    const rawContent = aiRes.choices[0]?.message?.content ?? "{}";
    const cleaned = rawContent.replace(/```json|```/g, "").trim();
    const jsonPayload = JSON.parse(extractJson(cleaned));
    const validated = AIInvoiceSchema.parse(jsonPayload);

    void captureServerEvent("ai_invoice_draft_generated", {
      userId: session.user.id,
      itemCount: validated.items.length,
    });

    return NextResponse.json({ data: validated });
  } catch {
    return NextResponse.json(
      { error: "Invalid AI response", fallback: fallbackDraft },
      { status: 400 },
    );
  }
};

export const POST = withTiming(
  withSpan("api.invoices.ai", generateInvoiceDraft, {
    op: "http.server",
    attributes: { "api.operation": "ai_invoice_draft" },
  }),
  { metricName: "api_invoices_ai_latency" },
);

