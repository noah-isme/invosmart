import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function RevenueInsightLoading() {
  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <div className="mb-10 space-y-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-72" />
        <SkeletonText lines={2} />
      </div>
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="glass-surface h-80 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <Skeleton className="mb-4 h-6 w-48" />
          <Skeleton className="mb-6 h-4 w-72" />
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="glass-surface h-80 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <Skeleton className="mb-4 h-6 w-56" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="glass-surface h-80 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <Skeleton className="mb-4 h-6 w-52" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
