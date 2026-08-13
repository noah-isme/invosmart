import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createClient, DEFAULT_MODEL } from "@/lib/ai";
import { z } from "zod";

import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { captureServerEvent } from "@/lib/server-telemetry";
import { withSpan } from "@/lib/tracing";
import { canReadWorkspace, resolveWorkspaceContextForRequest } from "@/lib/workspaces";

const systemPrompt = `
You are a receipt parsing assistant.
Given a base64 encoded image of a receipt, return a JSON object with this structure:
{
  "client": string (name of the client/vendor on the receipt),
  "items": [{"name": string, "qty": number, "price": number}],
  "dueAt": string (ISO 8601) or null,
  "notes": string (optional, e.g. receipt number or tax information)
}
Only respond with JSON.
`;

const requestSchema = z.object({
  image: z.string().min(1, "Image is required"),
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

const scanReceipt = async (request: NextRequest) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "receipts");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canReadWorkspace(workspace)) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
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

  const parsedPayload = requestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return NextResponse.json(
      { error: "Image tidak valid", fallback: fallbackDraft },
      { status: 400 },
    );
  }

  try {
    const client = createClient();

    // Need to correctly format the image prompt based on the API being used.
    // OpenAI and Gemini might handle images differently in their API structure
    // If the createClient in lib/ai is abstracting this, we might need to modify it or
    // use a generic structure if it supports multimodal.
    // Assuming createClient supports standard openAI vision format.

    const aiRes = await client.chat.completions.create({
      model: DEFAULT_MODEL, // This might need to be a vision capable model like gpt-4o or gemini-1.5-flash
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Parse this receipt." },
            {
              type: "image_url",
              image_url: {
                url: parsedPayload.data.image, // expected format "data:image/jpeg;base64,..."
              },
            },
          ],
        },
      ],
      temperature: 0.1, // low temperature for better parsing accuracy
    });

    const rawContent = aiRes.choices[0]?.message?.content ?? "{}";
    const cleaned = rawContent.replace(/```json|```/g, "").trim();
    const jsonPayload = JSON.parse(extractJson(cleaned));

    // We can reuse the AIInvoiceSchema since the output structure is the same
    // Or create a new one if it differs
    const { AIInvoiceSchema } = await import("@/lib/schemas");
    const validated = AIInvoiceSchema.parse(jsonPayload);

    void captureServerEvent("ai_receipt_scanned", {
      userId: session.user.id,
      itemCount: validated.items.length,
    });

    return NextResponse.json({ data: validated });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(e);
    return NextResponse.json(
      { error: "Invalid AI response", fallback: fallbackDraft, detail },
      { status: 400 },
    );
  }
};

export const POST = withTiming(
  withSpan("api.receipts.ai-scan", scanReceipt, {
    op: "http.server",
    attributes: { "api.operation": "ai_receipt_scan" },
  }),
  { metricName: "api_receipts_ai_scan_latency" },
);
