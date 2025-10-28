"use client";

import dynamic from "next/dynamic";

import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

const AIInvoiceGeneratorClient = dynamic(
  () =>
    import("./AIInvoiceGeneratorClient").then(
      (mod) => mod.AIInvoiceGeneratorClient,
    ),
  {
    ssr: false,
    loading: () => (
      <section className="glass-surface space-y-6 rounded-[28px] border border-white/10 bg-white/[0.05] p-8">
        <Skeleton className="h-6 w-44" />
        <SkeletonText lines={3} />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="h-11 w-32" />
        </div>
      </section>
    ),
  },
);

export function AIInvoiceGeneratorBoundary() {
  return <AIInvoiceGeneratorClient />;
}
