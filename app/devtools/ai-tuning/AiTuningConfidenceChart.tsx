"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { OptimizationLogEntry } from "@/lib/ai/optimizer";

type SerializableOptimizationLogEntry = Omit<OptimizationLogEntry, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type AiTuningConfidenceChartProps = {
  history: SerializableOptimizationLogEntry[];
};

const formatConfidence = (value: number) => `${Math.round(value * 100)}%`;

export function AiTuningConfidenceChart({ history }: AiTuningConfidenceChartProps) {
  const data = useMemo(
    () =>
      history
        .slice()
        .reverse()
        .map((entry, index) => ({
          id: entry.id,
          route: entry.route,
          confidence: Number((entry.evalConfidence ?? entry.confidence).toFixed(2)),
          label: `#${index + 1}`,
        })),
    [history],
  );

  if (!data.length) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] text-sm text-text/60">
        Belum ada histori optimasi.
      </div>
    );
  }

  return (
    <div className="h-64 w-full rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="label" stroke="rgba(255,255,255,0.6)" tickLine={false} />
          <YAxis domain={[0.6, 1]} tickFormatter={formatConfidence} stroke="rgba(255,255,255,0.6)" tickLine={false} />
          <Tooltip
            formatter={(value: number, _name, payload) => [formatConfidence(value), payload?.payload?.route]}
            contentStyle={{ background: "rgba(16,18,26,0.95)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <Bar dataKey="confidence" fill="rgba(99,102,241,0.85)" radius={[10, 10, 10, 10]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
