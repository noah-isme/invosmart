import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { db } from "@/lib/db";
import { authOptions } from "@/server/auth";

import { BrandingForm } from "./BrandingForm";

const FALLBACK_COLOR = "#6366f1";

export default async function BrandingSettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.email) {
    redirect("/auth/login");
  }

  const user = await db.user.findUnique({ where: { id: session.user.id } });

  if (!user) {
    redirect("/auth/login");
  }

  const branding = {
    logoUrl: user.logoUrl ?? "",
    primaryColor: user.primaryColor ?? FALLBACK_COLOR,
    fontFamily: (user.fontFamily as "sans" | "serif" | "mono" | null) ?? "sans",
  } as const;

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.42em] text-white/50">Pengaturan brand</p>
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold text-white">Branding dokumen PDF</h1>
          <p className="mt-3 text-base text-white/70">
            Bangun pengalaman profesional dengan mengatur logo, warna utama, dan tipografi invoice. Setiap perubahan
            diterapkan secara real-time pada preview dan unduhan PDF Anda.
          </p>
        </div>
      </header>

      <BrandingForm initialBranding={branding} />
    </main>
  );
}
