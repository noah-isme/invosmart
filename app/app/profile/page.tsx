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
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
      <section className="space-y-2">
        <p className="text-sm text-muted-foreground">Profil pengguna</p>
        <h1 className="text-3xl font-semibold">{name}</h1>
        <p className="text-sm text-muted-foreground">{email}</p>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-background/80 p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Detail akun</h2>
          <p className="text-sm text-muted-foreground">
            Informasi dasar akun Anda. Gunakan tombol di bawah untuk keluar secara aman.
          </p>
        </div>

        <dl className="grid gap-3 text-sm">
          <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/60 p-3">
            <dt className="text-xs uppercase text-muted-foreground">Nama</dt>
            <dd className="font-medium">{name}</dd>
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/60 p-3">
            <dt className="text-xs uppercase text-muted-foreground">Email</dt>
            <dd className="font-medium">{email}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-3">
          <SignOutButton />
          <Link
            href="/app"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Kembali ke dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
