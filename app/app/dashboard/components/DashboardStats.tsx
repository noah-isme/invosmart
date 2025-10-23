"use client";

import type { InvoiceDashboardStats } from "./types";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

type DashboardStatsProps = {
  stats: InvoiceDashboardStats;
};

export const DashboardStats = ({ stats }: DashboardStatsProps) => {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">Total pendapatan</p>
        <p className="mt-2 text-2xl font-semibold">{formatCurrency(stats.revenue)}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">Invoice belum dibayar</p>
        <p className="mt-2 text-2xl font-semibold">{stats.unpaid}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">Invoice overdue</p>
        <p className="mt-2 text-2xl font-semibold">{stats.overdue}</p>
      </div>
    </div>
  );
};
