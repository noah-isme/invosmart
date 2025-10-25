import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <div className="space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-6 w-32" rounded="lg" />
          <Skeleton className="h-12 w-64" />
          <SkeletonText lines={2} />
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    </main>
  );
}
