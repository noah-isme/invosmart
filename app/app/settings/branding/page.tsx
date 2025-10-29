import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { db } from "@/lib/db";
import { authOptions } from "@/server/auth";

import dynamic from "next/dynamic";

const BrandingForm = dynamic(() => import("./BrandingForm").then((mod) => mod.BrandingForm), {
  loading: () => <BrandingFormSkeleton />,
});

function BrandingFormSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-6">
        <div className="space-y-4">
          <div className="h-4 w-32 animate-pulse rounded-full bg-white/10" aria-hidden />
          <div className="space-y-3">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="h-10 w-full animate-pulse rounded-xl bg-white/10" aria-hidden />
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <div className="h-6 w-40 animate-pulse rounded-full bg-white/10" aria-hidden />
        <div className="mt-4 h-56 w-full animate-pulse rounded-2xl bg-white/10" aria-hidden />
      </div>
    </div>
  );
}

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
    syncWithTheme: Boolean(user.brandingSyncWithTheme),
    useThemeForPdf: Boolean(user.useThemeForPdf),
  } as const;

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">Pengaturan brand</p>
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold text-text">Branding dokumen PDF</h1>
          <p className="mt-3 text-base text-text/70">
            Bangun pengalaman profesional dengan mengatur logo, warna utama, dan tipografi invoice. Setiap perubahan
            diterapkan secara real-time pada preview dan unduhan PDF Anda.
          </p>
        </div>
      </header>

      <BrandingForm initialBranding={branding} />
    </main>
  );
}
