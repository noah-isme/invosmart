"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    href: "/app/dashboard",
    label: "Dashboard",
    description: "Pantau performa invoice Anda",
  },
  {
    href: "/app/dashboard/insight",
    label: "Insight Analytics",
    description: "Analitik pendapatan dan performa pembayaran",
  },
  {
    href: "/app/invoices/new",
    label: "Invoice Manual",
    description: "Buat invoice secara manual",
  },
  {
    href: "/app/ai-invoice",
    label: "AI Generator",
    description: "Generate draft invoice otomatis",
  },
  {
    href: "/app/profile",
    label: "Profil",
    description: "Kelola informasi akun",
  },
  {
    href: "/app/settings/branding",
    label: "Branding",
    description: "Sesuaikan logo, warna, dan font invoice",
  },
];

const isActivePath = (pathname: string, target: string) => {
  if (pathname === target) {
    return true;
  }

  if (target === "/app/dashboard" && pathname === "/app") {
    return true;
  }

  return pathname.startsWith(`${target}/`);
};

export const AppSidebar = () => {
  const pathname = usePathname();

  return (
    <aside className="w-full lg:w-64">
      <div className="rounded-2xl border border-border bg-background/80 p-6 shadow-lg shadow-black/20">
        <Link href="/app/dashboard" className="text-xl font-semibold text-foreground">
          InvoSmart
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">
          Kelola invoice, pantau status pembayaran, dan manfaatkan otomatisasi AI.
        </p>

        <nav aria-label="Menu utama" className="mt-6">
          <ul className="flex flex-col gap-2">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded-xl border px-4 py-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card/60 text-foreground hover:border-primary/60 hover:bg-primary/5"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="block font-medium">{item.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
};

