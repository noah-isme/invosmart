import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import OpenAI from "openai";

import {
  AiInvoiceInsightSchema,
  InvoiceInsightSummarySchema,
  type AiInvoiceInsight,
  type InvoiceInsightSummary,
} from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { captureServerEvent } from "@/lib/server-telemetry";

const MODEL = "gpt-4o-mini";

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(value);

const formatGrowth = (last: number, previous: number) => {
  if (!previous) {
    return null;
  }

  const diff = ((last - previous) / previous) * 100;
  return Number.isFinite(diff) ? Number(diff.toFixed(1)) : null;
};

const buildFallbackInsight = (summary: InvoiceInsightSummary): AiInvoiceInsight => {
  const { currency } = summary.period;
  const topClient = summary.topClients[0]?.client ?? "Klien utama";
  const totalRevenue = formatCurrency(summary.totals.revenue, currency);
  const lastMonth = summary.trend?.lastMonth ?? summary.totals.revenue;
  const previousMonth = summary.trend?.previousMonth ?? 0;
  const growth = formatGrowth(lastMonth, previousMonth);

  const growthText = (() => {
    if (growth === null) return "stabil";
    if (growth > 0) return `naik ${growth}%`; // positive growth
    if (growth < 0) return `turun ${Math.abs(growth)}%`;
    return "stabil";
  })();

  return {
    totalRevenue,
    topClient,
    insight: `Pendapatan periode ${summary.period.label} ${growthText} dengan ${summary.totals.paidInvoices} invoice berhasil dibayar dan ${summary.totals.overdueInvoices} masih overdue.`,
    recommendation: `Fokus pada ${topClient} untuk mempertahankan momentum dan kirimkan penawaran early payment bagi ${summary.topClients
      .slice(1, 3)
      .map((client) => client.client)
      .join(", ") || "klien lainnya"}.`,
  } satisfies AiInvoiceInsight;
};

const promptFromSummary = (summary: InvoiceInsightSummary) => {
  const template = {
    totals: summary.totals,
    monthlyRevenue: summary.monthlyRevenue,
    topClients: summary.topClients,
    recentInvoices: summary.recentInvoices ?? [],
    period: summary.period,
    trend: summary.trend ?? undefined,
  } satisfies InvoiceInsightSummary;

  const formatted = JSON.stringify(template, null, 2);

  return `Anda adalah analis finansial untuk SaaS invoice. Gunakan ringkasan data berikut untuk membuat insight bisnis yang jelas dan dapat ditindaklanjuti.
Data ringkasan:
${formatted}

Berikan respons dalam format JSON dengan struktur:
{
  "totalRevenue": "string dengan format rupiah",
  "topClient": "nama klien dengan kinerja terbaik",
  "insight": "ringkasan performa dalam 2 kalimat",
  "recommendation": "rekomendasi aksi praktis"
}

Gunakan bahasa Indonesia yang profesional.`;
};

const createClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const parseAiResponse = (content: string) => {
  const cleaned = content.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || start > end) {
    throw new Error("AI response does not contain JSON payload");
  }

  const payload = JSON.parse(cleaned.slice(start, end + 1));
  return AiInvoiceInsightSchema.parse(payload);
};

const generateInsight = async (request: NextRequest) => {
  const httpsResult = enforceHttps(request);
  if (httpsResult) {
    return httpsResult;
  }

  const limited = rateLimit(request, "ai-invoice-insight");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const parsed = InvoiceInsightSummarySchema.safeParse((json as { summary?: unknown })?.summary ?? json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ringkasan invoice tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const summary = parsed.data;
  const fallback = buildFallbackInsight(summary);

  try {
    const client = createClient();
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "Anda adalah analis finansial yang menyampaikan insight singkat dan actionable",
        },
        { role: "user", content: promptFromSummary(summary) },
      ],
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new Error("Empty AI response");
    }

    const insight = parseAiResponse(content);

    void captureServerEvent("ai_invoice_insight_generated", {
      userId: session.user.id,
      topClient: insight.topClient,
    });

    return NextResponse.json({ data: insight, fallback: false });
  } catch (error) {
    void captureServerEvent("ai_invoice_insight_fallback", {
      userId: session.user.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        data: fallback,
        fallback: true,
        error: "Gagal menghasilkan insight AI",
        message: error instanceof Error ? error.message : undefined,
      },
      { status: 200 },
    );
  }
};

export const POST = withTiming(generateInsight);
