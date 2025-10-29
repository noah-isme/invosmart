import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { canViewPerfTools, getPerfToolsSampleRate } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

import PerfDashboardClient from "./PerfDashboardClient";

function PerfDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div
            key={key}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-6"
          >
            <Skeleton className="mb-4 h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="mt-3 h-3 w-1/2" />
          </div>
        ))}
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <Skeleton className="mb-6 h-5 w-36" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <Skeleton className="mb-6 h-5 w-48" />
        <SkeletonText lines={5} />
      </div>
    </div>
  );
}

export default async function PerfToolsPage() {
  const session = await getServerSession(authOptions);

  if (!canViewPerfTools(session)) {
    redirect("/app");
  }

  const sampleRate = getPerfToolsSampleRate();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">DevTools</p>
        <h1 className="text-3xl font-semibold text-text">Performance observability</h1>
        <p className="text-sm text-text/65">
          Monitor Web Vitals, user input responsiveness, dan endpoint API kritikal secara real-time. Data hanya tersedia untuk
          admin internal.
        </p>
      </header>

      <Suspense fallback={<PerfDashboardSkeleton />}>
        <PerfDashboardClient defaultSampleRate={sampleRate} />
      </Suspense>
    </main>
  );
}

