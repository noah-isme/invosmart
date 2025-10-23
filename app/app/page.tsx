import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { authOptions } from "@/server/auth";

export default async function AppDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/login");
  }

  const displayName = session.user?.name ?? session.user?.email ?? "Pengguna";

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16">
      <section className="space-y-2">
        <p className="text-sm text-muted-foreground">Selamat datang kembali,</p>
        <h1 className="text-3xl font-semibold">{displayName}</h1>
        {session.user?.email ? (
          <p className="text-sm text-muted-foreground">{session.user.email}</p>
        ) : null}
        <p className="text-base text-muted-foreground">
          Halaman ini dilindungi middleware NextAuth. Gunakan area ini untuk dashboard invoice
          dan ringkasan bisnis Anda.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <SignOutButton />
        <Link
          href="/app/profile"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Lihat profil
        </Link>
        <Link
          href="/"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Kembali ke landing
        </Link>
      </div>
    </main>
  );
}
