import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { db } from "@/lib/db";
import { authOptions } from "@/server/auth";

import { ThemeSettingsPanel } from "./ThemeSettingsPanel";

const FALLBACK_THEME = {
  primary: "#6366f1",
  accent: "#22d3ee",
  mode: "dark" as const,
};

const formatHex = (value: string) => value.toUpperCase();

export default async function ThemeSettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      themePrimary: true,
      themeAccent: true,
      themeMode: true,
    },
  });

  const theme = {
    primary: user?.themePrimary?.toLowerCase() ?? FALLBACK_THEME.primary,
    accent: user?.themeAccent?.toLowerCase() ?? FALLBACK_THEME.accent,
    mode: (user?.themeMode === "light" ? "light" : "dark") as "light" | "dark",
  };

  const headline = session.user.name ?? session.user.email ?? "Pengguna";

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-24 pt-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">Pengaturan tampilan</p>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold text-text">Tema personal {headline}</h1>
          <p className="text-base text-text/65">
            Personalisasi warna utama, aksen, dan mode tampilan aplikasi. Setiap perubahan langsung diterapkan dan dapat disimpan
            ke akun Anda untuk konsistensi di semua perangkat.
          </p>
          <p className="text-sm text-text/55">
            Tema aktif: <span className="font-mono text-text">{formatHex(theme.primary)}</span> /{' '}
            <span className="font-mono text-text">{formatHex(theme.accent)}</span> — mode {theme.mode}.
          </p>
        </div>
      </header>

      <ThemeSettingsPanel />
    </main>
  );
}
