"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCcw, Sparkles, Users } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { InsightCard } from "@/components/ui/InsightCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/context/ToastContext";
import { trackEvent } from "@/lib/telemetry";
import type { RevenueInsight } from "@/lib/analytics";
import type { AiInvoiceInsight, InvoiceInsightSummary } from "@/lib/schemas";

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(value);

const buildLocalFallback = (summary: InvoiceInsightSummary): AiInvoiceInsight => {
  const { currency } = summary.period;
  const topClient = summary.topClients[0]?.client ?? "Klien utama";
  const totalRevenue = formatCurrency(summary.totals.revenue, currency);
  const lastMonth = summary.trend?.lastMonth ?? summary.totals.revenue;
  const previousMonth = summary.trend?.previousMonth ?? 0;
  const growth = previousMonth > 0 ? ((lastMonth - previousMonth) / previousMonth) * 100 : 0;
  const rounded = Number.isFinite(growth) ? Number(growth.toFixed(1)) : 0;
  const growthDirection = rounded > 0 ? "naik" : rounded < 0 ? "turun" : "stabil";
  const growthLabel = `${growthDirection}${rounded ? ` ${Math.abs(rounded)}%` : ""}`;

  const secondaryClient = summary.topClients[1]?.client;

  return {
    totalRevenue,
    topClient,
    insight: `Pendapatan ${summary.period.label} ${growthLabel} dengan ${summary.totals.paidInvoices} invoice berhasil dibayar. ${summary.totals.overdueInvoices} invoice masih overdue dan perlu tindak lanjut.`,
    recommendation: secondaryClient
      ? `Pertahankan loyalitas ${topClient} sekaligus rangkul ${secondaryClient} dengan penawaran early payment.`
      : `Pertahankan loyalitas ${topClient} dengan update rutin dan penawaran early payment khusus.`,
  } satisfies AiInvoiceInsight;
};

type InsightClientProps = {
  summary: InvoiceInsightSummary;
  revenueInsight: RevenueInsight;
};

export function InsightClient({ summary, revenueInsight }: InsightClientProps) {
  const { notify } = useToast();
  const [aiInsight, setAiInsight] = useState<AiInvoiceInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  const monthData = useMemo(
    () =>
      revenueInsight.months.map((month, index) => ({
        month,
        revenue: revenueInsight.revenue[index] ?? 0,
        paid: revenueInsight.paid[index] ?? 0,
        overdue: revenueInsight.overdue[index] ?? 0,
      })),
    [revenueInsight],
  );

  const topClientsChart = useMemo(
    () =>
      summary.topClients.slice(0, 6).map((client) => ({
        client: client.client,
        revenue: client.revenue,
      })),
    [summary.topClients],
  );

  const fetchInsight = useCallback(async () => {
    setLoading(true);
    setIsFallback(false);

    try {
      const response = await fetch("/api/ai/invoice-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      });

      if (!response.ok) {
        throw new Error("Permintaan insight gagal diproses");
      }

      const payload = (await response.json()) as {
        data: AiInvoiceInsight;
        fallback?: boolean;
        error?: string;
      };

      setAiInsight(payload.data);
      setIsFallback(Boolean(payload.fallback));

      trackEvent("ai_insight_generated", {
        fallback: Boolean(payload.fallback),
      });

      if (payload.fallback) {
        notify({
          title: "Insight AI menggunakan fallback",
          description: payload.error ?? "Menggunakan insight standar karena layanan AI tidak tersedia.",
          variant: "error",
        });
      }
    } catch (error) {
      const fallbackInsight = buildLocalFallback(summary);
      setAiInsight(fallbackInsight);
      setIsFallback(true);
      trackEvent("ai_insight_fallback", {});
      notify({
        title: "Insight AI tidak tersedia",
        description: error instanceof Error ? error.message : "Silakan coba lagi beberapa saat lagi.",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [notify, summary]);

  useEffect(() => {
    void fetchInsight();
  }, [fetchInsight]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="space-y-10"
    >
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">AI powered insight</p>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold text-text">AI Invoice Insights</h1>
            <p className="max-w-2xl text-base text-text/70">
              Dapatkan ringkasan performa keuangan dan rekomendasi strategis berbasis AI dari data invoice Anda.
            </p>
          </div>
          <Button
            onClick={fetchInsight}
            disabled={loading}
            className="inline-flex items-center gap-2"
            variant="secondary"
          >
            <RefreshCcw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Regenerate Insight
          </Button>
        </div>
        {isFallback ? (
          <p className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">
            Insight menampilkan data fallback untuk menjaga pengalaman Anda tetap lancar.
          </p>
        ) : null}
      </header>

      <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        {loading ? (
          <Skeleton className="h-[260px] w-full rounded-[28px]" />
        ) : aiInsight ? (
          <InsightCard
            title={aiInsight.totalRevenue}
            description={aiInsight.insight}
            recommendation={aiInsight.recommendation}
            highlight={`Klien utama: ${aiInsight.topClient}`}
            icon={<Sparkles className="size-6" aria-hidden />}
          />
        ) : (
          <Skeleton className="h-[260px] w-full rounded-[28px]" />
        )}

        <div className="glass-surface relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-accent)_/_0.16),_transparent_60%)]" />
          <div className="relative space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-text">
                <Users className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-text">Top Clients</h2>
                <p className="text-sm text-text/65">Enam klien dengan kontribusi revenue terbesar.</p>
              </div>
            </div>
            {summary.topClients.length ? (
              <ul className="space-y-2 text-sm text-text/70">
                {summary.topClients.slice(0, 6).map((client) => (
                  <li
                    key={client.client}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <span className="font-medium text-text">{client.client}</span>
                    <span className="text-xs uppercase tracking-[0.3em] text-text/50">
                      {client.paidInvoices} paid · {client.overdueInvoices} overdue
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <SkeletonText lines={4} />
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <motion.article
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="glass-surface relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]"
        >
          <header className="relative mb-4 space-y-1">
            <h2 className="text-lg font-semibold text-text">Tren Revenue 6 Bulan</h2>
            <p className="text-sm text-text/60">
              Visualisasi pendapatan bulanan, invoice paid, dan overdue untuk memantau momentum bisnis.
            </p>
          </header>
          <div className="relative h-72" role="img" aria-label="Grafik garis pendapatan dan status invoice enam bulan">
            {loading ? (
              <Skeleton className="h-full w-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthData}>
                  <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,0.12)" />
                  <XAxis dataKey="month" stroke="rgba(var(--color-text) / 0.45)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="rgba(var(--color-text) / 0.45)"
                    fontSize={12}
                    tickFormatter={(value) => formatCurrency(Number(value), summary.period.currency)}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value, summary.period.currency)}
                    labelFormatter={(label) => `Periode: ${label}`}
                    contentStyle={{
                      background: "rgba(12,15,24,0.92)",
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "rgb(var(--color-text))",
                      backdropFilter: "blur(12px)",
                    }}
                  />
                  <Line type="monotone" dataKey="revenue" stroke="rgb(var(--color-primary))" strokeWidth={2.4} dot={false} />
                  <Line type="monotone" dataKey="paid" stroke="rgb(var(--color-accent))" strokeWidth={2.2} dot={false} />
                  <Line type="monotone" dataKey="overdue" stroke="#f97316" strokeWidth={2.2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
          className="glass-surface relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]"
        >
          <header className="relative mb-4 space-y-1">
            <h2 className="text-lg font-semibold text-text">Kontribusi Revenue per Klien</h2>
            <p className="text-sm text-text/60">Distribusi revenue dari klien dengan performa terbaik.</p>
          </header>
          <div className="relative h-72" role="img" aria-label="Grafik batang kontribusi revenue per klien">
            {loading ? (
              <Skeleton className="h-full w-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topClientsChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                  <XAxis dataKey="client" stroke="rgba(var(--color-text) / 0.45)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="rgba(var(--color-text) / 0.45)"
                    fontSize={12}
                    tickFormatter={(value) => formatCurrency(Number(value), summary.period.currency)}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value, summary.period.currency)}
                    contentStyle={{
                      background: "rgba(12,15,24,0.92)",
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "rgb(var(--color-text))",
                      backdropFilter: "blur(12px)",
                    }}
                  />
                  <defs>
                    <linearGradient id="clientRevenue" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="rgb(var(--color-primary))" />
                      <stop offset="100%" stopColor="rgb(var(--color-accent))" />
                    </linearGradient>
                  </defs>
                  <Bar dataKey="revenue" radius={[14, 14, 0, 0]} fill="url(#clientRevenue)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.article>
      </section>
    </motion.section>
  );
}
