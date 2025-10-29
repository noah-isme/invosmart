import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth";

import { PerformanceSettingsPanel } from "./PerformanceSettingsPanel";

export default async function PerformanceSettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-24 pt-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">Pengaturan performa</p>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold text-text">AI predictive optimization</h1>
          <p className="text-base text-text/65">
            Kelola fitur prefetch adaptif berbasis rekomendasi AI. Aktifkan ketika Anda ingin navigasi antar halaman terasa
            instan, tanpa mengganggu metrik LCP utama.
          </p>
          <p className="text-sm text-text/55">
            Akun: <span className="font-medium text-text">{session.user.email ?? session.user.name ?? "Pengguna"}</span>
          </p>
        </div>
      </header>

      <PerformanceSettingsPanel />
    </main>
  );
}
