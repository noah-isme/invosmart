import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function PerfToolsLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12">
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-80" />
          <SkeletonText lines={2} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <Skeleton className="mb-3 h-3 w-16" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </main>
  );
}

