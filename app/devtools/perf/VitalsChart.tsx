"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";

type VitalPoint = {
  route: string;
  timestamp: string;
  p50: number;
  p95: number;
};

type ChartBucket = { timestamp: string } & Record<string, number>;

type VitalsChartProps = {
  data: VitalPoint[];
  metric: string;
};

const palette = ["#6366f1", "#22d3ee", "#f472b6", "#fb923c"];

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  return Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(date);
};

export function VitalsChart({ data, metric }: VitalsChartProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, []);

  const chartData = useMemo(() => {
    const timestamps = new Map<string, ChartBucket>();

    data.forEach((point) => {
      const existing = timestamps.get(point.timestamp);
      const bucket: ChartBucket = existing ?? ({ timestamp: point.timestamp } as ChartBucket);
      bucket[`${point.route}__p95`] = point.p95;
      bucket[`${point.route}__p50`] = point.p50;
      timestamps.set(point.timestamp, bucket);
    });

    return Array.from(timestamps.values()).sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }, [data]);

  const routes = useMemo(() => Array.from(new Set(data.map((point) => point.route))), [data]);

  if (!chartData.length) {
    return <p className="text-sm text-text/60">Belum ada data untuk rentang waktu terpilih.</p>;
  }

  const tooltipFormatter: TooltipProps<number, string>["formatter"] = (rawValue, name, item) => {
    const resolvedName = typeof name === "string" ? name : String(name ?? "");
    const [route] = resolvedName.split(" – ");

    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);

    const payloadRecord =
      item && typeof item === "object" && "payload" in item && item.payload
        ? (item.payload as Record<string, unknown>)
        : null;

    const rawP50 = payloadRecord?.[`${route}__p50`];
    const formattedValue = Number.isFinite(value) ? `${Math.round(value)} ms` : "—";
    const formattedP50 = typeof rawP50 === "number" && Number.isFinite(rawP50)
      ? `${Math.round(rawP50)} ms`
      : "—";

    return [formattedValue, `${route} · p95 (p50 ${formattedP50})`];
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text">{metric} trend</h2>
          <p className="text-xs text-text/60">
            Garis menunjukkan p95 untuk setiap rute. Tooltip menampilkan p50 sebagai referensi.
          </p>
        </div>
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTimestamp}
              stroke="rgba(255,255,255,0.35)"
            />
            <YAxis
              stroke="rgba(255,255,255,0.35)"
              tickFormatter={(value) => `${Math.round(value)} ms`}
              width={70}
            />
            <Tooltip
              labelFormatter={formatTimestamp}
              formatter={tooltipFormatter}
              cursor={{ stroke: "rgba(148,163,184,0.35)", strokeDasharray: "4 4" }}
            />
            <Legend wrapperStyle={{ color: "rgba(255,255,255,0.65)" }} />
            {routes.map((route, index) => (
              <Line
                key={route}
                type="monotone"
                dataKey={`${route}__p95`}
                name={`${route} – p95`}
                stroke={palette[index % palette.length]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={!prefersReducedMotion}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

