"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";

const VitalsChart = dynamic(() => import("./VitalsChart").then((mod) => mod.VitalsChart), {
  ssr: false,
  loading: () => <ChartPlaceholder title="Memuat grafik Web Vitals" />,
});

const InpDistributionChart = dynamic(
  () => import("./InpDistributionChart").then((mod) => mod.InpDistributionChart),
  {
    ssr: false,
    loading: () => <ChartPlaceholder title="Memuat distribusi INP" />,
  },
);

type VitalPoint = {
  route: string;
  timestamp: string;
  p50: number;
  p95: number;
};

type PerfSummary = {
  range: { start: string; end: string; label: string };
  sampleRate: number;
  metrics: {
    lcp: VitalPoint[];
    inp: VitalPoint[];
    fcp: VitalPoint[];
  };
  inpDistribution: { bucket: string; count: number }[];
  routeOutliers: { route: string; metric: string; p95: number; change: number; samples: number }[];
  slowApis: { endpoint: string; method: string; p95: number; p50: number; volume: number }[];
  lastUpdated: string;
};

type PerfDashboardClientProps = {
  defaultSampleRate: number;
};

const ranges = [
  { label: "24 jam", value: "24h" },
  { label: "48 jam", value: "48h" },
  { label: "7 hari", value: "7d" },
];

function ChartPlaceholder({ title }: { title: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
      <p className="text-sm text-text/60">{title}</p>
    </div>
  );
}

const SAMPLE_STORAGE_KEY = "invosmart:rum-sample-rate";

const round = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${Math.round(value)} ms`;
};

const toCsv = (summary: PerfSummary) => {
  const rows = [
    ["metric", "route", "timestamp", "p50", "p95"].join(","),
    ...summary.metrics.lcp.map((entry) =>
      ["LCP", entry.route, entry.timestamp, entry.p50, entry.p95].join(","),
    ),
    ...summary.metrics.inp.map((entry) =>
      ["INP", entry.route, entry.timestamp, entry.p50, entry.p95].join(","),
    ),
    ...summary.slowApis.map((entry) =>
      [
        "API",
        `${entry.method} ${entry.endpoint}`,
        summary.lastUpdated,
        entry.p50,
        entry.p95,
      ].join(","),
    ),
  ];

  return rows.join("\n");
};

export default function PerfDashboardClient({ defaultSampleRate }: PerfDashboardClientProps) {
  const [summary, setSummary] = useState<PerfSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("24h");
  const [selectedRoute, setSelectedRoute] = useState<string>("all");
  const [sampleRate, setSampleRate] = useState(defaultSampleRate);

  const routes = useMemo(() => {
    if (!summary) return [] as string[];
    const metricRoutes = summary.metrics.lcp.map((entry) => entry.route);
    return Array.from(new Set(metricRoutes));
  }, [summary]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const stored = window.localStorage.getItem(SAMPLE_STORAGE_KEY);
    if (!stored) return;

    const value = Number.parseFloat(stored);
    if (Number.isFinite(value)) {
      setSampleRate(Math.min(Math.max(value, 0), 1));
    }
  }, []);

  const fetchSummary = useCallback(
    async (rangeValue: string) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/dev/perf/summary?range=${rangeValue}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "Gagal memuat ringkasan performa");
        }

        const traceId = response.headers.get("x-trace-id");
        if (traceId && typeof window !== "undefined") {
          (window as typeof window & { __INVOSMART_TRACE_ID__?: string }).__INVOSMART_TRACE_ID__ = traceId;
        }

        const body = (await response.json()) as PerfSummary;
        setSummary(body);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        const message = err instanceof Error ? err.message : "Terjadi kesalahan tak terduga";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchSummary(range);
  }, [fetchSummary, range]);

  const filteredLcp = useMemo(
    () => summary?.metrics.lcp.filter((point) => selectedRoute === "all" || point.route === selectedRoute) ?? [],
    [selectedRoute, summary?.metrics.lcp],
  );

  const filteredInp = useMemo(
    () => summary?.metrics.inp.filter((point) => selectedRoute === "all" || point.route === selectedRoute) ?? [],
    [selectedRoute, summary?.metrics.inp],
  );

  const latestMetrics = useMemo(() => {
    const getLatest = (points: VitalPoint[]) => {
      if (!points.length) return null;
      return points.reduce((latest, current) =>
        new Date(latest.timestamp).getTime() > new Date(current.timestamp).getTime() ? latest : current,
      );
    };

    return {
      lcp: getLatest(filteredLcp),
      inp: getLatest(filteredInp),
    };
  }, [filteredLcp, filteredInp]);

  const handleSampleRateChange = (value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1);
    setSampleRate(clamped);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(SAMPLE_STORAGE_KEY, clamped.toString());
      (window as typeof window & { __INVOSMART_RUM_RATE__?: number }).__INVOSMART_RUM_RATE__ = clamped;
    }
  };

  const resetSampleRate = () => {
    setSampleRate(defaultSampleRate);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SAMPLE_STORAGE_KEY);
      (window as typeof window & { __INVOSMART_RUM_RATE__?: number }).__INVOSMART_RUM_RATE__ = defaultSampleRate;
    }
  };

  const handleExportCsv = () => {
    if (!summary) return;

    const csv = toCsv(summary);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `perf-${summary.range.label}-${summary.lastUpdated}.csv`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-text/45">p95 LCP</p>
          <p className="mt-2 text-2xl font-semibold text-text">{round(latestMetrics.lcp?.p95)}</p>
          <p className="text-xs text-text/50">Rute: {selectedRoute === "all" ? "Semua" : selectedRoute}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-text/45">p95 INP</p>
          <p className="mt-2 text-2xl font-semibold text-text">{round(latestMetrics.inp?.p95)}</p>
          <p className="text-xs text-text/50">Rute: {selectedRoute === "all" ? "Semua" : selectedRoute}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-text/45">Sampling RUM</p>
          <p className="mt-2 text-2xl font-semibold text-text">{Math.round(sampleRate * 100)}%</p>
          <p className="text-xs text-text/50">Default: {Math.round(defaultSampleRate * 100)}%</p>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-3">
            {ranges.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  range === item.value
                    ? "bg-primary/80 text-white"
                    : "bg-white/[0.04] text-text/70 hover:bg-white/[0.08]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs uppercase tracking-[0.25em] text-text/45" htmlFor="route-filter">
              Rute
            </label>
            <select
              id="route-filter"
              className="min-w-[160px] rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-text/80"
              value={selectedRoute}
              onChange={(event) => setSelectedRoute(event.target.value)}
            >
              <option value="all">Semua rute</option>
              {routes.map((route) => (
                <option key={route} value={route}>
                  {route}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {error ? (
            <p className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
          ) : null}
          {loading && !summary ? (
            <ChartPlaceholder title="Mengambil data performa..." />
          ) : null}
          {summary ? <VitalsChart data={filteredLcp} metric="LCP" /> : null}
          {summary ? <VitalsChart data={filteredInp} metric="INP" /> : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          {summary ? <InpDistributionChart data={summary.inpDistribution} /> : <ChartPlaceholder title="Memuat distribusi INP" />}
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-text">Rute outlier</h2>
          <p className="text-xs text-text/60">Pantau rute dengan degradasi signifikan.</p>
          <ul className="mt-4 space-y-3">
            {summary?.routeOutliers.map((item) => (
              <li key={`${item.route}-${item.metric}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-sm font-semibold text-text">{item.route}</p>
                <p className="text-xs text-text/55">
                  {item.metric} p95: {Math.round(item.p95)} ms · Δ {item.change}% · sampel {item.samples}
                </p>
              </li>
            )) ?? <p className="text-sm text-text/60">Tidak ada outlier.</p>}
          </ul>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text">Top API lambat (p95)</h2>
            <p className="text-xs text-text/60">Data dihitung dari ringkasan PostHog/Sentry internal.</p>
          </div>
          <Button onClick={handleExportCsv} variant="secondary" successLabel="Diekspor">
            Export CSV
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm text-text/80">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.24em] text-text/45">
                <th className="pb-2 pr-4">Endpoint</th>
                <th className="pb-2 pr-4">p50</th>
                <th className="pb-2 pr-4">p95</th>
                <th className="pb-2 pr-4">Volume</th>
              </tr>
            </thead>
            <tbody>
              {summary?.slowApis.map((api) => (
                <tr key={`${api.method}-${api.endpoint}`} className="border-t border-white/5">
                  <td className="py-3 pr-4 font-medium text-text">
                    <span className="mr-2 rounded-full bg-white/[0.08] px-2 py-1 text-xs uppercase tracking-wide text-text/70">
                      {api.method}
                    </span>
                    {api.endpoint}
                  </td>
                  <td className="py-3 pr-4">{round(api.p50)}</td>
                  <td className="py-3 pr-4">{round(api.p95)}</td>
                  <td className="py-3 pr-4">{api.volume}</td>
                </tr>
              )) ?? null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-text">Sampling override</h2>
        <p className="text-xs text-text/60">
          Atur sampling lokal untuk sesi ini. Simpanan berlaku di browser ini saja dan dapat dinonaktifkan kapan pun.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <input
            aria-label="Sampling rate"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={sampleRate}
            onChange={(event) => handleSampleRateChange(Number(event.target.value))}
            className="h-2 w-60 cursor-pointer appearance-none rounded-full bg-white/10"
          />
          <span className="text-sm text-text/70">{Math.round(sampleRate * 100)}%</span>
          <Button onClick={resetSampleRate} variant="ghost" successLabel="Reset">
            Reset
          </Button>
        </div>
        <p className="mt-2 text-xs text-text/55">
          Perubahan sampling membutuhkan muat ulang halaman untuk diterapkan sepenuhnya pada sesi baru.
        </p>
      </section>
    </div>
  );
}

