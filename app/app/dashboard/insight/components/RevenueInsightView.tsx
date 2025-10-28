"use client";

import * as FramerMotion from "framer-motion";
import { useMemo } from "react";

type MotionModule = typeof import("framer-motion") & {
  useReducedMotion?: () => boolean;
};

const motionModule = FramerMotion as MotionModule;
const { motion } = motionModule;
const resolvedUseReducedMotion:
  | MotionModule["useReducedMotion"]
  | (() => boolean) =
  "useReducedMotion" in motionModule &&
  typeof motionModule.useReducedMotion === "function"
    ? motionModule.useReducedMotion.bind(motionModule)
    : () => false;
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { RevenueInsight } from "@/lib/analytics";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

const getChartData = (insight: RevenueInsight) =>
  insight.months.map((month, index) => ({
    month,
    revenue: insight.revenue[index] ?? 0,
    paid: insight.paid[index] ?? 0,
    overdue: insight.overdue[index] ?? 0,
  }));

const aggregateStatus = (insight: RevenueInsight) => [
  { status: "Paid", value: insight.paid.reduce((sum, count) => sum + count, 0) },
  {
    status: "Overdue",
    value: insight.overdue.reduce((sum, count) => sum + count, 0),
  },
];

type RevenueInsightViewProps = {
  insight: RevenueInsight;
};

export const RevenueInsightView = ({ insight }: RevenueInsightViewProps) => {
  const shouldReduceMotion = resolvedUseReducedMotion();
  const chartData = useMemo(() => getChartData(insight), [insight]);
  const statusData = useMemo(() => aggregateStatus(insight), [insight]);
  const transition = useMemo(
    () => ({
      duration: shouldReduceMotion ? 0.18 : 0.26,
      ease: "easeOut" as const,
    }),
    [shouldReduceMotion],
  );

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-3">
        <motion.article
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition}
          className="glass-surface relative overflow-hidden rounded-[28px] border border-white/6 bg-white/[0.04] p-6 shadow-[0_24px_70px_rgba(8,10,16,0.55)] lg:col-span-2"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.18),_transparent_55%)]" />
          <header className="relative mb-6 space-y-2">
            <h2 className="text-xl font-semibold text-text">Monthly Revenue (Last 6 Months)</h2>
            <p className="text-sm text-text/60">
              Tren revenue 6 bulan terakhir dan perbandingan status pembayaran untuk pengambilan keputusan lebih cepat.
            </p>
          </header>
          <div className="relative h-80" role="img" aria-label="Line chart showing revenue trends for the last six months">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,0.15)" />
                <XAxis dataKey="month" stroke="rgba(var(--color-text) / 0.45)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="rgba(var(--color-text) / 0.45)"
                  fontSize={12}
                  tickFormatter={(value) => formatCurrency(value as number)}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => `Periode: ${label}`}
                  contentStyle={{
                    background: "rgba(24,27,34,0.88)",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgb(var(--color-text))",
                    backdropFilter: "blur(8px)",
                    willChange: "transform",
                  }}
                />
                <Legend wrapperStyle={{ color: "rgb(var(--color-text))" }} iconType="circle" verticalAlign="bottom" height={32} />
                <Line type="monotone" dataKey="revenue" stroke="rgb(var(--color-primary))" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="paid" stroke="rgb(var(--color-accent))" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="overdue" stroke="#F87171" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition, delay: shouldReduceMotion ? 0 : 0.08 }}
          className="glass-surface relative overflow-hidden rounded-[28px] border border-white/6 bg-white/[0.04] p-6 shadow-[0_24px_70px_rgba(8,10,16,0.55)]"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-accent)_/_0.16),_transparent_60%)]" />
          <header className="relative mb-6">
            <h2 className="text-xl font-semibold text-text">Paid vs Overdue invoices</h2>
            <p className="text-sm text-text/60">Jumlah invoice yang dibayar dibandingkan dengan yang terlambat.</p>
          </header>
          <div className="relative h-80" role="img" aria-label="Bar chart comparing paid and overdue invoices">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,0.12)" />
                <XAxis dataKey="status" stroke="rgba(var(--color-text) / 0.45)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="rgba(var(--color-text) / 0.45)"
                  fontSize={12}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value: number) => `${value} invoice`}
                  contentStyle={{
                    background: "rgba(14,16,22,0.9)",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgb(var(--color-text))",
                    backdropFilter: "blur(8px)",
                    willChange: "transform",
                  }}
                />
                <Bar dataKey="value" radius={[14, 14, 0, 0]} fill="url(#statusGradient)" />
                <defs>
                  <linearGradient id="statusGradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--color-primary))" />
                    <stop offset="100%" stopColor="rgb(var(--color-accent))" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.article>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <motion.article
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition, delay: shouldReduceMotion ? 0 : 0.12 }}
          className="glass-surface rounded-[26px] border border-white/6 bg-white/[0.04] p-6 shadow-[0_24px_60px_rgba(8,10,16,0.45)]"
        >
          <h3 className="text-lg font-semibold text-text">🏆 Klien paling cepat membayar</h3>
          {insight.topClient ? (
            <p className="mt-4 text-sm text-text/70">
              <span className="font-semibold text-text">{insight.topClient.client}</span> menyelesaikan pembayaran dalam
              rata-rata <span className="text-text">{insight.topClient.averageDays} hari</span> setelah invoice diterbitkan.
            </p>
          ) : (
            <p className="mt-4 text-sm text-text/60">
              Belum ada data pembayaran untuk menentukan klien tercepat.
            </p>
          )}
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition, delay: shouldReduceMotion ? 0 : 0.16 }}
          className="glass-surface rounded-[26px] border border-white/6 bg-white/[0.04] p-6 shadow-[0_24px_60px_rgba(8,10,16,0.45)]"
        >
          <h3 className="text-lg font-semibold text-text">⚠️ Klien dengan invoice overdue</h3>
          {insight.overdueClients.length ? (
            <ul className="mt-4 space-y-2 text-sm text-text/70">
              {insight.overdueClients.map((client) => (
                <li
                  key={client}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                >
                  <span>{client}</span>
                  <span className="text-xs uppercase tracking-[0.3em] text-text/40">Overdue</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-text/60">Tidak ada klien yang terlambat membayar saat ini.</p>
          )}
        </motion.article>
      </section>
    </div>
  );
};
