import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <div className="space-y-10">
        <section className="space-y-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-10 w-64" />
          <SkeletonText lines={2} />
        </section>
        <section className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="glass-surface rounded-2xl border border-white/10 bg-white/[0.04] p-6"
            >
              <Skeleton className="mb-4 h-4 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </section>
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-9 w-28" />
          </div>
          <div className="glass-surface rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex items-center gap-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
