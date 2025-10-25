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
    <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16">
      <section className="glass-surface relative overflow-hidden rounded-[28px] border border-white/5 p-10 shadow-[0_24px_60px_rgba(8,10,16,0.55)]">
        <div className="absolute right-10 top-10 h-24 w-24 rounded-full bg-primary/30 blur-3xl" aria-hidden />
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">Selamat datang kembali</p>
        <h1 className="mt-4 text-4xl font-semibold text-text">{displayName}</h1>
        {session.user?.email ? (
          <p className="mt-2 text-sm text-text/60">{session.user.email}</p>
        ) : null}
        <p className="mt-6 max-w-xl text-base text-text/70">
          Akses seluruh fitur InvoSmart—dashboard, analitik, generator AI, dan pengaturan branding—dalam satu workspace modern.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SignOutButton>
            Keluar
          </SignOutButton>
          <Link
            href="/app/profile"
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-text/80 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Lihat profil
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-transparent px-4 py-2 text-sm font-medium text-text/70 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Kembali ke landing
          </Link>
        </div>
      </section>
    </main>
  );
}
