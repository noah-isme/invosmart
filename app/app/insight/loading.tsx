import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function InsightLoading() {
  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" rounded="lg" />
          <Skeleton className="h-12 w-72" />
          <SkeletonText lines={3} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <Skeleton className="h-[260px] w-full" />
          <Skeleton className="h-[260px] w-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      </div>
    </main>
  );
}
