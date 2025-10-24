import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { DashboardContent } from "./components/DashboardContent";
import { authOptions } from "@/server/auth";

export default async function InvoiceDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <DashboardContent />
    </main>
  );
}
