"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DistributionBucket = {
  bucket: string;
  count: number;
};

type InpDistributionChartProps = {
  data: DistributionBucket[];
};

export function InpDistributionChart({ data }: InpDistributionChartProps) {
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

  if (!data.length) {
    return <p className="text-sm text-text/60">Belum ada distribusi INP untuk rentang waktu ini.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-text">Distribusi INP</h2>
        <p className="text-xs text-text/60">Amati persebaran latensi interaksi pengguna untuk mendeteksi outlier.</p>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="bucket" stroke="rgba(255,255,255,0.35)" />
            <YAxis stroke="rgba(255,255,255,0.35)" allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(148,163,184,0.15)" }} />
            <Bar
              dataKey="count"
              fill="#6366f1"
              radius={[12, 12, 0, 0]}
              isAnimationActive={!prefersReducedMotion}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

