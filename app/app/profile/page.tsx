import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { authOptions } from "@/server/auth";

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/login");
  }

  const name = session.user?.name ?? "Tanpa nama";
  const email = session.user?.email ?? "Email tidak tersedia";

  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20 pt-12">
      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-white/50">Profil pengguna</p>
        <h1 className="text-4xl font-semibold text-white">{name}</h1>
        <p className="text-sm text-white/60">{email}</p>
      </section>

      <section className="glass-surface space-y-6 rounded-[30px] border border-white/5 bg-white/[0.04] p-8 shadow-[0_28px_70px_rgba(8,10,16,0.55)]">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Detail akun</h2>
          <p className="text-sm text-white/65">
            Informasi dasar akun Anda. Gunakan tombol di bawah untuk keluar secara aman atau kembali ke dashboard.
          </p>
        </div>

        <dl className="grid gap-4 text-sm text-white/70 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <dt className="text-[0.65rem] uppercase tracking-[0.32em] text-white/45">Nama</dt>
            <dd className="mt-2 text-base font-semibold text-white">{name}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <dt className="text-[0.65rem] uppercase tracking-[0.32em] text-white/45">Email</dt>
            <dd className="mt-2 text-base font-semibold text-white">{email}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-3">
          <SignOutButton />
          <Link
            href="/app"
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:text-white"
          >
            Kembali ke dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
