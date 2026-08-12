"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Server, XCircle } from "lucide-react";

type UptimeRecord = {
  id?: string;
  url: string;
  name?: string;
  statusCode: number;
  latencyMs: number;
  status: string;
  error?: string | null;
  createdAt: string;
};

type EndpointStat = {
  url: string;
  name: string;
  currentStatus: "UP" | "DOWN" | "UNKNOWN";
  latestStatusCode: number | null;
  latestLatencyMs: number;
  latestCheckAt: string | null;
  uptimePercentage: number;
  avgLatencyMs: number;
  totalChecks: number;
  recentChecks?: Array<{
    id?: string;
    statusCode: number;
    latencyMs: number;
    status: string;
    createdAt: string;
  }>;
};

export default function UptimeMonitoringPage() {
  const [history, setHistory] = useState<UptimeRecord[]>([]);
  const [stats, setStats] = useState<EndpointStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPinging, setIsPinging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchUptimeData = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await fetch("/api/admin/uptime?limit=50");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch uptime data`);
      }
      const data = await res.json();
      setHistory(data.history || []);
      setStats(data.stats || []);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal memuat data uptime monitoring.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUptimeData();
  }, []);

  const handleManualPing = async () => {
    try {
      setIsPinging(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const res = await fetch("/api/admin/uptime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to trigger ping`);
      }

      const data = await res.json();
      setHistory(data.history || []);
      setStats(data.stats || []);
      setSuccessMessage("Pengujian ping manual berhasil dieksekusi.");

      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal mengeksekusi manual ping.",
      );
    } finally {
      setIsPinging(false);
    }
  };

  const formatDateTime = (value: string | Date | null) => {
    if (!value) return "–";
    return new Date(value).toLocaleString("id-ID", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="flex flex-col gap-8 p-6 text-white">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-indigo-300">
            <Link href="/app/admin" className="hover:underline">
              Admin
            </Link>
            <span>/</span>
            <span>Uptime Monitoring</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2 mt-1">
            <Activity className="h-7 w-7 text-indigo-400" />
            Uptime & System Health Monitoring
          </h1>
          <p className="text-sm text-white/70">
            Pantau status kesehatan endpoint internal, latensi 24 jam, dan riwayat ping otomatis.
          </p>
        </div>

        <button
          onClick={handleManualPing}
          disabled={isPinging || loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-indigo-500 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isPinging ? "animate-spin" : ""}`} />
          {isPinging ? "Mengecek Endpoint..." : "Trigger Manual Ping"}
        </button>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Endpoint Status Badges & 24h Summary Cards */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Server className="h-5 w-5 text-indigo-400" />
          Status Endpoint (24 Jam Terakhir)
        </h2>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-40 rounded-2xl border border-white/10 bg-white/5 p-6 animate-pulse"
              />
            ))}
          </div>
        ) : stats.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">
            Belum ada data status endpoint. Klik &quot;Trigger Manual Ping&quot; untuk memulai.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {stats.map((stat) => {
              const isUp = stat.currentStatus === "UP";
              const isDown = stat.currentStatus === "DOWN";

              return (
                <div
                  key={stat.url}
                  className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-md transition hover:border-white/20"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white text-base">{stat.name}</h3>
                      <p className="text-xs font-mono text-white/60 mt-0.5">{stat.url}</p>
                    </div>

                    {/* Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${
                        isUp
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          : isDown
                          ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          : "bg-gray-500/20 text-gray-300 border-gray-500/30"
                      }`}
                    >
                      {isUp ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ONLINE (UP)
                        </>
                      ) : isDown ? (
                        <>
                          <XCircle className="h-3.5 w-3.5 text-rose-400" />
                          OFFLINE (DOWN)
                        </>
                      ) : (
                        <>
                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                          UNKNOWN
                        </>
                      )}
                    </span>
                  </div>

                  {/* 24h Metrics */}
                  <div className="grid grid-cols-3 gap-2 mt-6 pt-4 border-t border-white/10 text-center">
                    <div>
                      <span className="text-xs text-white/60 block">Uptime 24h</span>
                      <span
                        className={`text-lg font-bold ${
                          stat.uptimePercentage >= 99
                            ? "text-emerald-400"
                            : stat.uptimePercentage >= 90
                            ? "text-amber-400"
                            : "text-rose-400"
                        }`}
                      >
                        {stat.uptimePercentage}%
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-white/60 block">Rata-rata Latensi</span>
                      <span className="text-lg font-bold text-indigo-300">
                        {stat.avgLatencyMs} ms
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-white/60 block">Status Terakhir</span>
                      <span className="text-lg font-bold text-white">
                        {stat.latestStatusCode ? `HTTP ${stat.latestStatusCode}` : "–"}
                      </span>
                    </div>
                  </div>

                  {/* Latest Ping Timestamp */}
                  <div className="mt-4 text-xs text-white/50 flex items-center justify-between">
                    <span>Terakhir diperiksa: {formatDateTime(stat.latestCheckAt)}</span>
                    <span>Total Ping 24h: {stat.totalChecks}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* History Table */}
      <section className="rounded-2xl border border-white/10 bg-white/5 shadow-xl backdrop-blur-md overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-400" />
              Riwayat Ping Endpoint (50 Terakhir)
            </h2>
            <p className="text-xs text-white/60 mt-0.5">
              Log pemeriksaan status kesehatan sistem secara real-time.
            </p>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-white/80">
            <thead className="bg-white/10 text-xs uppercase text-white/60">
              <tr>
                <th className="px-6 py-3">Waktu</th>
                <th className="px-6 py-3">Endpoint URL</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">HTTP Code</th>
                <th className="px-6 py-3">Latensi (ms)</th>
                <th className="px-6 py-3">Pesan / Error</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-white/50">
                    Memuat riwayat uptime...
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-white/50">
                    Belum ada riwayat pings yang tercatat.
                  </td>
                </tr>
              ) : (
                history.map((record) => {
                  const isUp = record.status === "UP";
                  return (
                    <tr key={record.id || record.createdAt} className="border-t border-white/10 hover:bg-white/5">
                      <td className="px-6 py-3 whitespace-nowrap text-xs text-white/70">
                        {formatDateTime(record.createdAt)}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-indigo-300">
                        {record.url}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border ${
                            isUp
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          }`}
                        >
                          {isUp ? "UP" : "DOWN"}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-white/80">
                        {record.statusCode > 0 ? record.statusCode : "ERR"}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-white/80">
                        {record.latencyMs} ms
                      </td>
                      <td className="px-6 py-3 text-xs text-white/60">
                        {record.error ? (
                          <span className="text-rose-400 font-mono">{record.error}</span>
                        ) : (
                          <span className="text-emerald-400/80">Normal (OK)</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
