import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { db } from "@/lib/db";
import { authOptions } from "@/server/auth";
import { LanguageSettingsPanel } from "./LanguageSettingsPanel";
import type { Locale } from "@/lib/i18n";

export default async function LanguageSettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      locale: true,
      name: true,
      email: true,
    },
  });

  const currentLocale = (user?.locale === "id" ? "id" : "en") as Locale;
  const userName = user?.name ?? session.user.name ?? user?.email ?? "User";

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-24 pt-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">Pengaturan / Settings</p>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold text-text">Pengaturan Bahasa ({userName})</h1>
          <p className="text-base text-text/65">
            Pilih dan kelola bahasa antarmuka aplikasi. Setiap perubahan disimpan ke profil Anda dan berlaku di seluruh aplikasi.
          </p>
        </div>
      </header>

      <LanguageSettingsPanel initialLocale={currentLocale} />
    </main>
  );
}
