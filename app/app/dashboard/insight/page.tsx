import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { RevenueInsightView } from "./components/RevenueInsightView";
import { getRevenueInsight } from "@/lib/analytics";
import { authOptions } from "@/server/auth";

export const metadata = {
  title: "Revenue Insight | InvoSmart",
};

export default async function InsightDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const insight = await getRevenueInsight(session.user.id);

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <div className="mb-10 space-y-4">
        <p className="text-xs uppercase tracking-[0.42em] text-white/50">Analitik pendapatan</p>
        <h1 className="text-4xl font-semibold text-white">Insight pembayaran real-time</h1>
        <p className="max-w-2xl text-base text-white/70">
          Pelajari tren revenue, distribusi status invoice, serta perilaku pembayaran klien untuk menentukan langkah strategis
          berikutnya.
        </p>
      </div>
      <RevenueInsightView insight={insight} />
    </main>
  );
}
