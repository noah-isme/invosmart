"use client";

import dynamic from "next/dynamic";

import type { RevenueInsight } from "@/lib/analytics";
import { Skeleton } from "@/components/ui/Skeleton";

const RevenueInsightView = dynamic(
  () =>
    import("./components/RevenueInsightView").then(
      (mod) => mod.RevenueInsightView,
    ),
  {
    ssr: false,
    loading: () => (
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="glass-surface h-80 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <Skeleton className="mb-4 h-6 w-48" />
          <Skeleton className="mb-6 h-4 w-64" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="glass-surface h-80 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <Skeleton className="mb-4 h-6 w-56" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="glass-surface hidden h-80 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 lg:block">
          <Skeleton className="mb-4 h-6 w-52" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </section>
    ),
  },
);

export function RevenueInsightBoundary({ insight }: { insight: RevenueInsight }) {
  return <RevenueInsightView insight={insight} />;
}
