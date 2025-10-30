"use client";

import { useMemo, useState, useTransition } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { LoopTelemetry } from "@/lib/ai/loop";

export type DashboardState = {
  enabled: boolean;
  intervalMs: number;
  concurrency: number;
  history: LoopTelemetry[];
  recentPriorities: Array<{
    id: string;
    agent: string;
    weight: number;
    confidence: number;
    rationale: string | null;
    updatedAt: string;
  }>;
  recoveryLog: Array<{
    id: string;
    agent: string;
    action: string;
    reason: string;
    createdAt: string;
    trustScoreBefore?: number | null;
    trustScoreAfter?: number | null;
    traceId?: string;
  }>;
};

const formatInterval = (intervalMs: number) => {
  const minutes = intervalMs / 60000;
  if (minutes < 1) {
    return `${Math.round(intervalMs / 1000)}s`;
  }
  return `${minutes.toFixed(minutes < 3 ? 2 : 1)}m`;
};

const statusBadge = (enabled: boolean) => {
  return enabled ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">
      <span className="h-2 w-2 rounded-full bg-emerald-400" /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-400">
      <span className="h-2 w-2 rounded-full bg-rose-400" /> Paused
    </span>
  );
};

const buildChartData = (history: LoopTelemetry[]) => {
  return history.map((item, index) => ({
    index,
    load: Number((item.load * 100).toFixed(1)),
    trust: Number(item.trustScore.toFixed(1)),
    success: Number((item.successRate * 100).toFixed(1)),
    error: Number((item.errorRate * 100).toFixed(2)),
  }));
};

const AutonomyDashboardClient = ({ initialState }: { initialState: DashboardState }) => {
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();

  const chartData = useMemo(() => buildChartData(state.history), [state.history]);

  const toggleLoop = (action: "pause" | "resume") => {
    startTransition(async () => {
      const response = await fetch("/api/devtools/autonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        console.error("Failed to toggle autonomy loop", await response.text());
        return;
      }

      const payload = (await response.json()) as { state: DashboardState };
      setState((prev) => ({
        ...prev,
        ...payload.state,
        recentPriorities: payload.state.recentPriorities ?? prev.recentPriorities,
        recoveryLog: payload.state.recoveryLog ?? prev.recoveryLog,
        history: payload.state.history ?? prev.history,
      }));
    });
  };

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/5 p-6 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white/90">Autonomy Loop Status</h2>
            {statusBadge(state.enabled)}
          </div>
          <p className="mt-1 text-sm text-white/60">
            Interval adaptif: <span className="font-medium text-white/80">{formatInterval(state.intervalMs)}</span> · Concurrency:{" "}
            <span className="font-medium text-white/80">{state.concurrency}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-white/10 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/30 hover:text-white"
            onClick={() => toggleLoop("pause")}
            disabled={!state.enabled || isPending}
          >
            Pause
          </button>
          <button
            type="button"
            className="rounded-md bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-400"
            onClick={() => toggleLoop("resume")}
            disabled={state.enabled || isPending}
          >
            Resume
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Loop Telemetry</h3>
          <div className="mt-4 h-60 w-full">
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="loadGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="trustGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="index" tickLine={false} axisLine={false} stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "rgba(15, 23, 42, 0.9)", borderRadius: 12, border: "1px solid rgba(148, 163, 184, 0.2)" }}
                  labelFormatter={(index) => `Iterasi #${index}`}
                  formatter={(value, name) => [`${value}%`, name === "load" ? "Load" : name === "trust" ? "Trust" : name === "success" ? "Success" : "Error"]}
                />
                <Area type="monotone" dataKey="load" stroke="#6366f1" fill="url(#loadGradient)" strokeWidth={2} name="load" />
                <Area type="monotone" dataKey="trust" stroke="#22d3ee" fill="url(#trustGradient)" strokeWidth={2} name="trust" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur lg:col-span-1">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Prioritas Agen</h3>
          <ul className="mt-4 space-y-3">
            {state.recentPriorities.slice(0, 5).map((priority) => (
              <li key={priority.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
                <div className="flex items-center justify-between text-sm text-white/70">
                  <span className="font-semibold uppercase tracking-wide text-white/80">{priority.agent}</span>
                  <span>{(priority.weight * 100).toFixed(1)}%</span>
                </div>
                <p className="mt-1 text-xs text-white/60">Confidence {(priority.confidence * 100).toFixed(0)}%</p>
              </li>
            ))}
            {state.recentPriorities.length === 0 && <p className="text-sm text-white/60">Belum ada prioritas tersimpan.</p>}
          </ul>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur lg:col-span-1">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Recovery Log</h3>
          <ul className="mt-4 space-y-3">
            {state.recoveryLog.slice(0, 5).map((entry) => (
              <li key={entry.id} className="rounded-lg border border-white/5 bg-black/20 p-3 text-sm text-white/70">
                <div className="flex items-center justify-between">
                  <span className="font-semibold uppercase tracking-wide text-white/80">{entry.agent}</span>
                  <span className="text-xs uppercase text-white/60">{entry.action}</span>
                </div>
                <p className="mt-1 text-xs text-white/60">{entry.reason}</p>
              </li>
            ))}
            {state.recoveryLog.length === 0 && <p className="text-sm text-white/60">Belum ada tindakan recovery.</p>}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default AutonomyDashboardClient;
