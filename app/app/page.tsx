import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth";

export default async function AppDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16">
      <section className="space-y-2">
        <p className="text-sm text-muted-foreground">Selamat datang kembali,</p>
        <h1 className="text-3xl font-semibold">
          {session.user?.name ?? session.user?.email ?? "Pengguna"}
        </h1>
        <p className="text-base text-muted-foreground">
          Halaman ini dilindungi middleware NextAuth. Gunakan area ini untuk dashboard invoice
          dan ringkasan bisnis Anda.
        </p>
      </section>

      <div className="flex gap-3">
        <Link
          href="/api/auth/signout"
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Sign out
        </Link>
        <Link
          href="/"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Kembali ke landing
        </Link>
      </div>
    </main>
  );
}
