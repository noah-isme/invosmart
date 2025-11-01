"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";

import type { TrustAggregateState, ModelUpdateState } from "@/lib/ai/federationAgent";
import type {
  FederationEndpointStatus,
  FederationEvent,
  FederationSnapshot,
  TelemetrySyncPayload,
  PrioritySharePayload,
  TrustAggregatePayload,
  ModelUpdatePayload,
} from "@/lib/federation/protocol";

export type FederationDashboardState = {
  enabled: boolean;
  tenantId: string;
  endpoints: string[];
  connections: FederationEndpointStatus[];
  recentEvents: FederationEvent[];
  snapshots: FederationSnapshot[];
  trustHistory: TrustAggregateState[];
  modelHistory: ModelUpdateState[];
};

type FilterValue = "all" | "healthy" | "degraded" | "critical";

const toNode = (snapshot: FederationSnapshot, localTenant: string): Node => ({
  id: snapshot.tenantId,
  position: { x: Math.random() * 400, y: Math.random() * 200 },
  data: {
    label: `${snapshot.tenantId === localTenant ? "(You) " : ""}${snapshot.tenantId}`,
    trust: snapshot.trustScore,
    priorities: snapshot.priorities,
  },
  type: "default",
  style: {
    border: snapshot.tenantId === localTenant ? "2px solid var(--primary)" : "1px solid var(--border)",
    padding: 12,
    borderRadius: 12,
    background: "var(--surface)",
    minWidth: 160,
  },
});

const buildEdges = (tenantId: string, connections: FederationEndpointStatus[]): Edge[] => {
  return connections.map((connection, index) => ({
    id: `${tenantId}->${connection.endpoint}-${index}`,
    source: tenantId,
    target: connection.endpoint,
    animated: connection.healthy,
    style: {
      stroke: connection.healthy ? "#22c55e" : "#ef4444",
    },
    label: connection.healthy ? "synced" : "down",
    labelStyle: {
      fill: connection.healthy ? "#16a34a" : "#b91c1c",
      fontWeight: 600,
    },
  }));
};

const filterSnapshots = (
  snapshots: FederationSnapshot[],
  filter: FilterValue,
  connections: FederationEndpointStatus[],
  localTenant: string,
) => {
  if (filter === "all") return snapshots;

  if (filter === "healthy") {
    const healthyTenants = new Set(connections.filter((item) => item.healthy).map((item) => item.endpoint));
    return snapshots.filter(
      (snapshot) => healthyTenants.has(snapshot.tenantId) || snapshot.tenantId === localTenant,
    );
  }

  if (filter === "degraded") {
    return snapshots.filter((snapshot) => snapshot.trustScore >= 50 && snapshot.trustScore < 75);
  }

  return snapshots.filter((snapshot) => snapshot.trustScore < 50);
};

const formatTrustHistory = (history: TrustAggregateState[]) =>
  history.slice(0, 20).map((entry) => ({
    cycle: entry.cycleId,
    trust: entry.averageTrust,
    participants: entry.participants,
    timestamp: new Date(entry.receivedAt).toLocaleTimeString(),
  }));

const formatModelHistory = (history: ModelUpdateState[]) =>
  history.slice(0, 12).map((entry) => ({
    cycle: entry.cycleId,
    trust: entry.trustScore,
    timestamp: new Date(entry.receivedAt).toLocaleTimeString(),
  }));

const PriorityList = ({ priorities }: { priorities: FederationSnapshot["priorities"] }) => (
  <ul className="space-y-1">
    {priorities.map((priority) => (
      <li key={`${priority.agent}-${priority.rationale}`} className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-text/70">{priority.agent}</span>
        <span className="text-text/70">
          {(priority.weight * 100).toFixed(1)}% · c={priority.confidence.toFixed(2)}
        </span>
      </li>
    ))}
  </ul>
);

const StatusBadge = ({ healthy }: { healthy: boolean }) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${healthy ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"}`}
  >
    <span className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-rose-500"}`} />
    {healthy ? "Healthy" : "Degraded"}
  </span>
);

const EmptyState = ({ children }: { children: ReactNode }) => (
  <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 text-sm text-text/60">
    {children}
  </div>
);

const fetchStatus = async (method: "GET" | "POST") => {
  const response = await fetch("/api/federation/status", {
    method,
    headers: { "x-federation-ui": "true" },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error ?? "Gagal memuat status federasi");
  }

  return (await response.json()) as {
    status: {
      enabled: boolean;
      tenantId: string;
      endpoints: string[];
      connections: FederationEndpointStatus[];
      recentEvents: FederationEvent[];
    };
    snapshots: FederationSnapshot[];
    trustHistory: TrustAggregateState[];
    modelHistory: ModelUpdateState[];
  };
};

const describeFederationEvent = (event: FederationEvent) => {
  switch (event.type) {
    case "telemetry_sync": {
      const payload = event.payload as TelemetrySyncPayload;
      const priorities = payload.priorities.length;
      return `Telemetry trust ${payload.trustScore.toFixed(1)} · ${priorities} prioritas`;
    }
    case "priority_share": {
      const payload = event.payload as PrioritySharePayload;
      return `Prioritas global siklus ${payload.cycleId}`;
    }
    case "trust_aggregate": {
      const payload = event.payload as TrustAggregatePayload;
      return (
        payload.summary ??
        `Rata-rata trust ${payload.averageTrust.toFixed(1)} dengan ${payload.participants} partisipan`
      );
    }
    case "model_update": {
      const payload = event.payload as ModelUpdatePayload;
      return `Model sinkronisasi ${payload.cycleId} · trust ${payload.trustScore.toFixed(1)}`;
    }
    default:
      return "Event federasi";
  }
};

const AiFederationClient = ({ initialState }: { initialState: FederationDashboardState }) => {
  const [state, setState] = useState(initialState);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (method: "GET" | "POST" = "GET") => {
      if (!state.enabled) return;
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchStatus(method);
        setState((previous) => ({
          ...previous,
          ...payload.status,
          snapshots: payload.snapshots,
          trustHistory: payload.trustHistory,
          modelHistory: payload.modelHistory,
        }));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Tidak dapat memuat federasi");
      } finally {
        setLoading(false);
      }
    },
    [state.enabled],
  );

  useEffect(() => {
    if (!state.enabled) return;

    const interval = setInterval(() => {
      void refresh();
    }, 15000);

    return () => clearInterval(interval);
  }, [state.enabled, refresh]);

  const filteredSnapshots = useMemo(
    () => filterSnapshots(state.snapshots, filter, state.connections, state.tenantId),
    [state.snapshots, filter, state.connections, state.tenantId],
  );

  const nodes = useMemo(() => filteredSnapshots.map((snapshot) => toNode(snapshot, state.tenantId)), [
    filteredSnapshots,
    state.tenantId,
  ]);
  const edges = useMemo(() => buildEdges(state.tenantId, state.connections), [state.tenantId, state.connections]);

  const trustSeries = useMemo(() => formatTrustHistory(state.trustHistory), [state.trustHistory]);
  const modelSeries = useMemo(() => formatModelHistory(state.modelHistory), [state.modelHistory]);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge healthy={state.connections.every((connection) => connection.healthy)} />
        <button
          type="button"
          onClick={() => void refresh("POST")}
          disabled={loading || !state.enabled}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Syncing..." : "Manual Re-sync"}
        </button>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as FilterValue)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text shadow-sm focus:border-primary focus:outline-none"
        >
          <option value="all">Semua Instance</option>
          <option value="healthy">Terhubung</option>
          <option value="degraded">Trust 50-74</option>
          <option value="critical">Trust &lt; 50</option>
        </select>
        <span className="text-xs text-text/50">Tenant aktif: {state.snapshots.length}</span>
      </div>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-surface/60 p-4">
          <h2 className="text-lg font-semibold text-text">Peta Jaringan Federasi</h2>
          <p className="mt-1 text-sm text-text/60">
            Node menunjukkan setiap tenant beserta skor trust terkini. Garis hijau menandakan koneksi sinkron.
          </p>
          <div className="mt-4 h-[360px] rounded-xl border border-border/60">
            {nodes.length ? (
              <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.2 }}>
                <Background gap={16} size={1} color="rgba(148, 163, 184, 0.1)" />
                <MiniMap pannable zoomable />
                <Controls showFitView showInteractive={false} />
              </ReactFlow>
            ) : (
              <EmptyState>Tidak ada telemetry federasi yang tersinkron.</EmptyState>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/60 p-4">
          <h2 className="text-lg font-semibold text-text">Detail Tenant</h2>
          <div className="space-y-3 overflow-y-auto">
            {filteredSnapshots.length ? (
              filteredSnapshots.map((snapshot) => (
                <article key={snapshot.tenantId} className="rounded-xl border border-border/60 bg-surface/80 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text">{snapshot.tenantId}</h3>
                    <span className="text-xs font-medium text-text/60">Trust {snapshot.trustScore.toFixed(1)}</span>
                  </div>
                  <PriorityList priorities={snapshot.priorities} />
                </article>
              ))
            ) : (
              <EmptyState>Pilih filter lain untuk melihat tenant.</EmptyState>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface/60 p-4">
          <h2 className="text-lg font-semibold text-text">Rangkaian Trust Global</h2>
          <div className="mt-4 h-64">
            {trustSeries.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trustSeries}>
                  <XAxis dataKey="timestamp" stroke="#94a3b8" fontSize={12} angle={-15} textAnchor="end" height={50} />
                  <YAxis stroke="#94a3b8" domain={[0, 100]} fontSize={12} />
                  <Tooltip contentStyle={{ background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b" }} />
                  <Line type="monotone" dataKey="trust" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>Belum ada agregasi trust global.</EmptyState>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface/60 p-4">
          <h2 className="text-lg font-semibold text-text">Sinkronisasi Model</h2>
          <div className="mt-4 h-64">
            {modelSeries.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={modelSeries}>
                  <defs>
                    <linearGradient id="modelGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="timestamp" stroke="#94a3b8" fontSize={12} angle={-15} textAnchor="end" height={50} />
                  <YAxis stroke="#94a3b8" domain={[0, 100]} fontSize={12} />
                  <Tooltip contentStyle={{ background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b" }} />
                  <Area type="monotone" dataKey="trust" stroke="#22d3ee" fill="url(#modelGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>Belum ada update model lintas tenant.</EmptyState>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface/60 p-4">
        <h2 className="text-lg font-semibold text-text">Event Terbaru</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {state.recentEvents.slice(0, 8).map((event) => (
            <div key={event.id} className="rounded-xl border border-border/60 bg-surface/80 p-4 text-sm">
              <div className="flex items-center justify-between text-xs text-text/50">
                <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                <span className="font-medium uppercase tracking-wide text-text/60">{event.type}</span>
              </div>
              <p className="mt-2 text-text/80">{describeFederationEvent(event)}</p>
              <p className="mt-1 text-xs text-text/50">{event.tenantId}</p>
            </div>
          ))}
          {!state.recentEvents.length ? <EmptyState>Tidak ada event federasi terbaru.</EmptyState> : null}
        </div>
      </div>
    </section>
  );
};

export default AiFederationClient;
