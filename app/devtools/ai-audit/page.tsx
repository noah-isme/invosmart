import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { AiAuditClient, type AuditEntry } from "@/app/devtools/ai-audit/AiAuditClient";
import { db } from "@/lib/db";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

const normalizeDataBasis = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${JSON.stringify(entry)}`)
      .slice(0, 6);
  }

  if (typeof value === "string") {
    return value.split(/\n|\./).map((item) => item.trim()).filter(Boolean);
  }

  return [];
};

export default async function AiAuditPage() {
  const session = await getServerSession(authOptions);

  if (!canViewPerfTools(session)) {
    redirect("/app");
  }

  const logs = await db.optimizationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 120,
    include: {
      explanations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const entries: AuditEntry[] = logs.map((log) => {
    const explanation = log.explanations[0] ?? null;
    return {
      id: log.id,
      route: log.route,
      suggestion: log.change,
      impact: log.impact,
      status: log.status,
      policyStatus: log.policyStatus,
      policyReason: log.policyReason,
      explanation: explanation?.why ?? null,
      explanationContext: explanation?.context ?? null,
      dataBasis: explanation ? normalizeDataBasis(explanation.dataBasis) : [],
      confidence: explanation?.confidence ?? log.confidence,
      trustScore: explanation?.trustScore ?? null,
      createdAt: log.createdAt.toISOString(),
      explanationCreatedAt: explanation?.createdAt.toISOString() ?? null,
    } satisfies AuditEntry;
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">DevTools</p>
        <h1 className="text-3xl font-semibold text-text">AI Audit Trail Explorer</h1>
        <p className="text-sm text-text/65">
          Telusuri seluruh rekomendasi, penjelasan, dan status kebijakan AI secara kronologis untuk audit internal maupun eksternal.
        </p>
      </header>

      <AiAuditClient entries={entries} />
    </main>
  );
}
