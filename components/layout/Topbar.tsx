"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface TopbarProps {
  title?: string;
  actions?: ReactNode;
}

const routeTitles: Record<string, string> = {
  "/app": "Workspace",
  "/app/dashboard": "Dashboard",
  "/app/dashboard/insight": "Revenue Insight",
  "/app/insight": "AI Invoice Insights",
  "/app/about": "Tentang InvoSmart",
  "/app/help": "Pusat Bantuan",
  "/app/profile": "Profil",
  "/app/ai-invoice": "AI Generator",
  "/app/invoices": "Invoice",
  "/app/settings/theme": "Pengaturan Tema",
  "/app/settings/branding": "Branding",
};

const resolveTitle = (pathname: string) => {
  if (routeTitles[pathname]) {
    return routeTitles[pathname];
  }

  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return "InvoSmart";
  }

  const last = segments[segments.length - 1] ?? "";
  return last
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export default function Topbar({ title, actions }: TopbarProps) {
  const pathname = usePathname();

  const computedTitle = useMemo(() => title ?? resolveTitle(pathname), [pathname, title]);

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-14 border-b border-white/10 bg-white/[0.08] backdrop-blur-md transition-colors duration-200">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4">
        <h1 className="text-base font-semibold text-text">{computedTitle}</h1>
        {actions ? <div className="flex items-center gap-3 text-sm text-text/80">{actions}</div> : null}
      </div>
    </header>
  );
}
