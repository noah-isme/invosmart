"use client";

import { Menu, X } from "lucide-react";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface TopbarProps {
  title?: string;
  actions?: ReactNode;
  onToggleNavigation?: () => void;
  isNavigationOpen?: boolean;
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

export default function Topbar({
  title,
  actions,
  onToggleNavigation,
  isNavigationOpen,
}: TopbarProps) {
  const pathname = usePathname();

  const computedTitle = useMemo(() => title ?? resolveTitle(pathname), [pathname, title]);

  const NavigationIcon = isNavigationOpen ? X : Menu;
  const navigationLabel = isNavigationOpen ? "Tutup menu navigasi" : "Buka menu navigasi";

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-14 border-b border-white/10 bg-white/[0.08] backdrop-blur-md transition-colors duration-200">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {onToggleNavigation ? (
            <button
              type="button"
              onClick={onToggleNavigation}
              aria-label={navigationLabel}
              aria-expanded={isNavigationOpen ?? false}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-text transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg lg:hidden"
            >
              <NavigationIcon className="size-4" />
            </button>
          ) : null}
          <h1 className="text-base font-semibold text-text">{computedTitle}</h1>
        </div>
        {actions ? <div className="flex items-center gap-3 text-sm text-text/80">{actions}</div> : null}
      </div>
    </header>
  );
}
