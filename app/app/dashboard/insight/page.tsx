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
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-foreground">Revenue Analytics</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Analitik pendapatan membantu Anda memantau tren pembayaran, mengidentifikasi klien tercepat, dan fokus pada
          invoice yang perlu perhatian khusus.
        </p>
      </div>
      <RevenueInsightView insight={insight} />
    </main>
  );
}
