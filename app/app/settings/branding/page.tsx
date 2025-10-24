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
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Pengaturan</p>
        <h1 className="text-3xl font-semibold text-foreground">Branding PDF</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sesuaikan logo, warna utama, dan font agar PDF invoice selaras dengan identitas brand Anda.
          Perubahan akan diterapkan otomatis pada fitur download PDF.
        </p>
      </header>

      <BrandingForm initialBranding={branding} />
    </main>
  );
}
