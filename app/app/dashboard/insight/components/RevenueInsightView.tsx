"use client";

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
  const chartData = getChartData(insight);
  const statusData = aggregateStatus(insight);

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-3">
        <article className="rounded-2xl border border-border bg-card/80 p-6 shadow-lg shadow-black/10 lg:col-span-2">
          <header className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Monthly Revenue (Last 6 Months)
              </h2>
              <p className="text-sm text-muted-foreground">
                Total pendapatan untuk setiap bulan berdasarkan invoice yang telah dibayar.
              </p>
            </div>
          </header>
          <div className="h-80" role="img" aria-label="Line chart showing revenue trends for the last six months">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="4 4" stroke="#E5E7EB" />
                <XAxis dataKey="month" stroke="#6B7280" fontSize={12} />
                <YAxis
                  stroke="#6B7280"
                  fontSize={12}
                  tickFormatter={(value) => formatCurrency(value as number)}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => `Month: ${label}`}
                />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#2563EB" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="paid" stroke="#16A34A" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="overdue" stroke="#DC2626" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="rounded-2xl border border-border bg-card/80 p-6 shadow-lg shadow-black/10">
          <header className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Paid vs Overdue invoices</h2>
            <p className="text-sm text-muted-foreground">
              Distribusi invoice yang telah dibayar dibandingkan dengan yang terlambat.
            </p>
          </header>
          <div className="h-80" role="img" aria-label="Bar chart comparing paid and overdue invoices">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="4 4" stroke="#E5E7EB" />
                <XAxis dataKey="status" stroke="#6B7280" fontSize={12} />
                <YAxis stroke="#6B7280" fontSize={12} allowDecimals={false} />
                <Tooltip formatter={(value: number) => `${value} invoices`} />
                <Bar dataKey="value" fill="#7C3AED" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <article className="rounded-2xl border border-border bg-card/80 p-6 shadow-lg shadow-black/10">
          <h3 className="text-base font-semibold text-foreground">🏆 Top client by payment speed</h3>
          {insight.topClient ? (
            <p className="mt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{insight.topClient.client}</span> membayar rata-rata dalam
              <span className="font-semibold text-foreground"> {insight.topClient.averageDays} hari</span> setelah invoice diterbitkan.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Belum ada data pembayaran untuk menentukan klien tercepat.
            </p>
          )}
        </article>
        <article className="rounded-2xl border border-border bg-card/80 p-6 shadow-lg shadow-black/10">
          <h3 className="text-base font-semibold text-foreground">⚠️ Clients with overdue invoices</h3>
          {insight.overdueClients.length ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
              {insight.overdueClients.map((client) => (
                <li key={client} className="text-foreground">
                  {client}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Tidak ada klien yang terlambat membayar saat ini.</p>
          )}
        </article>
      </section>
    </div>
  );
};
