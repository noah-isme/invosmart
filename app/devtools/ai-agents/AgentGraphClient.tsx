"use client";

import "reactflow/dist/style.css";

import { useMemo, useState } from "react";
import ReactFlow, { Background, Controls, MiniMap, MarkerType, type Edge, type Node } from "reactflow";

import type { AgentRegistration, MapEvent } from "@/lib/ai/protocol";

const computeStatus = (latest: MapEvent | undefined) => {
  if (!latest) {
    return { label: "Idle", tone: "bg-white/5 text-text/60" } as const;
  }
  const age = Date.now() - new Date(latest.timestamp).getTime();
  const isFresh = age < 15 * 60 * 1000;
  const tone = isFresh
    ? "bg-emerald-500/10 text-emerald-200 border border-emerald-500/30"
    : "bg-amber-500/10 text-amber-200 border border-amber-500/30";
  return {
    label: `${latest.type} • ${isFresh ? "aktif" : "menunggu"}`,
    tone,
  } as const;
};

type AgentGraphClientProps = {
  enabled: boolean;
  agents: AgentRegistration[];
  events: MapEvent[];
  conflicts: { traceId: string; winningEvent: MapEvent | null }[];
};

const buildNodes = (agents: AgentRegistration[], events: MapEvent[]): Node[] => {
  const horizontalSpacing = 240;
  const verticalSpacing = 180;
  const latestByAgent = new Map<string, MapEvent>();
  events.forEach((event) => {
    const current = latestByAgent.get(event.source);
    if (!current || new Date(event.timestamp).getTime() > new Date(current.timestamp).getTime()) {
      latestByAgent.set(event.source, event);
    }
  });

  return agents.map((agent, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const status = computeStatus(latestByAgent.get(agent.agentId));
    return {
      id: agent.agentId,
      position: { x: column * horizontalSpacing, y: row * verticalSpacing },
      data: {
        label: (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-text">{agent.name}</span>
            <span className={`w-fit rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em] ${status.tone}`}>{status.label}</span>
          </div>
        ),
      },
      type: "default",
      style: {
        borderRadius: 18,
        padding: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(15,23,42,0.6)",
        color: "#F8FAFC",
        width: 220,
      },
    } satisfies Node;
  });
};

const buildEdges = (events: MapEvent[]): Edge[] => {
  const counts = new Map<string, number>();
  events.forEach((event) => {
    if (!event.target) return;
    const key = `${event.source}->${event.target}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([key, count]) => {
    const [source, target] = key.split("->");
    return {
      id: key,
      source,
      target,
      animated: true,
      label: `${count} event`,
      style: { stroke: "#38BDF8" },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#38BDF8' },
    } satisfies Edge;
  });
};

const formatEventLabel = (event: MapEvent) => {
  const time = new Date(event.timestamp).toLocaleTimeString();
  return `${time} • ${event.source} → ${event.target ?? "broadcast"} • ${event.type}`;
};

export default function AgentGraphClient({ enabled, agents, events, conflicts }: AgentGraphClientProps) {
  const [showOnlyConflicts, setShowOnlyConflicts] = useState(false);

  const filteredEvents = useMemo(() => {
    if (!showOnlyConflicts) return events;
    const conflictTraceIds = new Set(conflicts.map((conflict) => conflict.traceId));
    return events.filter((event) => conflictTraceIds.has(event.traceId));
  }, [conflicts, events, showOnlyConflicts]);

  const nodes = useMemo(() => buildNodes(agents, filteredEvents), [agents, filteredEvents]);
  const edges = useMemo(() => buildEdges(filteredEvents), [filteredEvents]);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-text/50">Agent graph</p>
            <h2 className="text-2xl font-semibold text-text">Multi-agent orchestration</h2>
            <p className="mt-1 text-sm text-text/60">
              {enabled
                ? "Visualisasi hubungan antar agen dan aktivitas event stream AI."
                : "AI orchestration belum diaktifkan — set ENABLE_AI_ORCHESTRATION=true untuk mengaktifkan graf."}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text/70">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-white/30 bg-white/5"
              checked={showOnlyConflicts}
              onChange={(event) => setShowOnlyConflicts(event.target.checked)}
            />
            Tampilkan hanya trace konflik
          </label>
        </header>

        <div className="mt-6 h-[420px] w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40">
          <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.2 }}>
            <MiniMap pannable zoomable className="!bg-slate-900/70" />
            <Controls className="!bg-slate-900/80 !text-slate-100" />
            <Background gap={18} size={1} color="rgba(255,255,255,0.08)" />
          </ReactFlow>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-text/45">Event stream</p>
              <h3 className="text-lg font-semibold text-text">Log terbaru ({filteredEvents.length})</h3>
            </div>
          </header>
          <ul className="space-y-3 text-sm text-text/75">
            {filteredEvents.map((event) => (
              <li key={`${event.traceId}-${event.timestamp}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text/55">
                  <span>{new Date(event.timestamp).toLocaleString()}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] uppercase tracking-[0.2em]">
                    {event.type}
                  </span>
                </div>
                <p className="mt-2 font-medium text-text">
                  {event.source} → {event.target ?? "broadcast"}
                </p>
                <p className="mt-1 text-xs text-text/65">{event.payload.summary}</p>
                {event.payload.context ? (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-2 text-[11px] text-text/60">
                    {JSON.stringify(event.payload.context, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
            {filteredEvents.length === 0 && (
              <li className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-text/55">
                Belum ada event yang terekam untuk filter saat ini.
              </li>
            )}
          </ul>
        </div>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <header>
            <p className="text-xs uppercase tracking-[0.32em] text-text/45">Conflict resolution</p>
            <h3 className="text-lg font-semibold text-text">Trace audit</h3>
            <p className="mt-1 text-xs text-text/65">
              Konflik ditangani deterministik dengan prioritas governance → optimizer → learning → insight.
            </p>
          </header>
          <ul className="space-y-3 text-sm text-text/75">
            {conflicts.map((conflict) => (
              <li key={conflict.traceId} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text">Trace {conflict.traceId}</span>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
                    {conflict.winningEvent?.source ?? "unknown"}
                  </span>
                </div>
                {conflict.winningEvent ? (
                  <p className="mt-2 text-xs text-text/65">{formatEventLabel(conflict.winningEvent)}</p>
                ) : (
                  <p className="mt-2 text-xs text-text/55">Tidak ada event yang menang.</p>
                )}
              </li>
            ))}
            {conflicts.length === 0 && (
              <li className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-text/55">
                Tidak ada konflik aktif dalam window event ini.
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
