import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function AIInvoiceLoading() {
  return (
    <div className="space-y-10 pb-12">
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
      <section className="glass-surface space-y-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
        <Skeleton className="h-6 w-56" />
        <SkeletonText lines={4} />
        <Skeleton className="h-10 w-40" />
      </section>
    </div>
  );
}
