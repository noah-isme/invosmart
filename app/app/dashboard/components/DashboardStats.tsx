"use client";

import { motion } from "framer-motion";

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

const cards = (
  stats: InvoiceDashboardStats,
): Array<{ id: string; label: string; value: string; helper: string }> => [
  {
    id: "revenue",
    label: "Total pendapatan",
    value: formatCurrency(stats.revenue),
    helper: "Akumulasi invoice berhasil dibayar",
  },
  {
    id: "unpaid",
    label: "Invoice belum dibayar",
    value: stats.unpaid.toString(),
    helper: "Perlu tindak lanjut atau pengingat",
  },
  {
    id: "overdue",
    label: "Invoice overdue",
    value: stats.overdue.toString(),
    helper: "Segera hubungi klien terkait",
  },
];

export const DashboardStats = ({ stats }: DashboardStatsProps) => {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {cards(stats).map((card, index) => (
        <motion.article
          key={card.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.08, duration: 0.35, ease: "easeOut" }}
          className="relative"
        >
          <div className="glow-border rounded-[28px]">
            <div className="glow-border-inner overflow-hidden rounded-[26px] p-6">
              <motion.span
                aria-hidden
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 0.85, scale: 1 }}
                transition={{ delay: 0.15 + index * 0.05, duration: 0.6, ease: "easeOut" }}
                className="pointer-events-none absolute -right-10 top-0 h-24 w-24 rounded-full bg-primary/20 blur-3xl"
              />
              <motion.span
                aria-hidden
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 0.55, y: 0 }}
                transition={{ delay: 0.2 + index * 0.05, duration: 0.65, ease: "easeOut" }}
                className="pointer-events-none absolute -bottom-10 left-6 h-24 w-24 rounded-full bg-accent/10 blur-[90px]"
              />
              <div className="relative flex flex-col gap-4">
                <p className="text-xs uppercase tracking-[0.32em] text-text/55">{card.label}</p>
                <p className="text-3xl font-semibold text-text">{card.value}</p>
                <p className="text-sm text-text/65">{card.helper}</p>
              </div>
            </div>
          </div>
        </motion.article>
      ))}
    </div>
  );
};
