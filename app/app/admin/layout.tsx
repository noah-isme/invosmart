import type { ReactNode } from "react";

import Link from "next/link";

const navItems = [
  { href: "/app/admin/experiments", label: "Eksperimen" },
  { href: "/app/admin/auto-actions", label: "AUTO Log" },
];

type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-3 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-semibold text-white">AI Optimizer Control Center</h1>
          <p className="text-sm text-white/70">
            Monitor eksperimen konten, rekomendasi jadwal, dan tindakan otomatis AI.
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full border border-white/10 px-4 py-2 text-white/80 transition hover:border-white/40 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex flex-col gap-8">{children}</main>
    </div>
  );
}
