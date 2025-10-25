"use client";

import { type ComponentType, useMemo, useState, type CSSProperties } from "react";
import {
  BarChart3,
  ChevronsLeftRight,
  FilePenLine,
  LayoutDashboard,
  LogOut,
  Palette,
  Sparkles,
  SunMoon,
  UserCircle2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/auth/SignOutButton";

const WIDTH_EXPANDED = 240;
const WIDTH_COLLAPSED = 88;

const STORAGE_KEY = "invosmart.sidebar";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  {
    href: "/app/dashboard",
    label: "Dashboard",
    description: "Ikhtisar performa & aktivitas",
    icon: LayoutDashboard,
  },
  {
    href: "/app/dashboard/insight",
    label: "Insight Analytics",
    description: "Tren revenue dan status pembayaran",
    icon: BarChart3,
  },
  {
    href: "/app/invoices/new",
    label: "Invoice Manual",
    description: "Susun invoice profesional secara manual",
    icon: FilePenLine,
  },
  {
    href: "/app/ai-invoice",
    label: "AI Generator",
    description: "Gunakan AI untuk membuat draft invoice",
    icon: Sparkles,
  },
  {
    href: "/app/profile",
    label: "Profil",
    description: "Kelola identitas dan keamanan akun",
    icon: UserCircle2,
  },
  {
    href: "/app/settings/theme",
    label: "Tema",
    description: "Personalisasi warna aplikasi",
    icon: SunMoon,
  },
  {
    href: "/app/settings/branding",
    label: "Branding",
    description: "Warna, logo, dan font brand Anda",
    icon: Palette,
  },
];

const isActivePath = (pathname: string, href: string) => {
  if (pathname === href) return true;
  if (href === "/app/dashboard" && (pathname === "/app" || pathname === "/app/dashboard")) {
    return true;
  }

  return pathname.startsWith(`${href}/`);
};

const getInitialCollapsed = () => {
  if (typeof window === "undefined") return false;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "1";
};

export default function Sidebar() {
  const pathname = usePathname();
  const sessionResult = useSession();
  const session = sessionResult?.data;
  const [isCollapsed, setIsCollapsed] = useState(() => getInitialCollapsed());

  const initials = useMemo(() => {
    const source = session?.user?.name ?? session?.user?.email ?? "InvoSmart";
    return source
      .split(" ")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .join("")
      .slice(0, 2) || "IS";
  }, [session?.user?.email, session?.user?.name]);

  const sidebarStyle = {
    "--sidebar-width": `${isCollapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED}px`,
  } as CSSProperties;

  const toggle = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    }
  };

  return (
    <aside
      aria-label="Navigasi utama"
      style={sidebarStyle}
      className="group sticky top-20 hidden h-[calc(100vh-5rem)] w-full max-w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md shadow-[0_24px_70px_rgba(8,10,16,0.55)] transition-[width] duration-300 ease-out lg:flex lg:[width:var(--sidebar-width)]"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-4 pt-6">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/20 text-sm font-semibold text-text shadow-primary-glow">
            {initials}
          </span>
          {!isCollapsed ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text">{session?.user?.name ?? "InvoSmart"}</p>
              {session?.user?.email ? (
                <p className="truncate text-xs text-text/60">{session?.user?.email}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <nav aria-label="Menu aplikasi" className="mt-6 flex-1 space-y-1 px-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                data-tooltip={isCollapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                  active
                    ? "bg-white/10 text-text shadow-[0_0_20px_rgba(var(--color-primary)_/_0.35)]"
                    : "text-text/70 hover:bg-white/10 hover:text-text"
                } ${isCollapsed ? "justify-center" : ""}`}
              >
                <span
                  className={`flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-text/80 transition-colors ${
                    active ? "text-text" : ""
                  }`}
                >
                  <Icon className="size-4" />
                </span>
                {!isCollapsed ? (
                  <span className="flex flex-col overflow-hidden">
                    <span className="truncate text-sm text-text">{item.label}</span>
                    <span className="truncate text-xs text-text/60">{item.description}</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 px-4 pb-20">
          <div
            className={`flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 ${
              isCollapsed ? "flex-col text-center" : "text-left"
            }`}
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-sm font-semibold text-text shadow-accent-glow">
              {initials}
            </div>
            {!isCollapsed ? (
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-semibold text-text">
                  {session?.user?.name ?? session?.user?.email ?? "Pengguna InvoSmart"}
                </p>
                <p className="text-xs text-text/60">Akun aktif</p>
              </div>
            ) : null}
            <SignOutButton
              className={`inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs font-medium text-text transition-all hover:bg-white/20 ${
                isCollapsed ? "w-full" : ""
              }`}
            >
              <LogOut className="size-4" />
              {!isCollapsed ? <span>Keluar</span> : null}
            </SignOutButton>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={isCollapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
        aria-pressed={isCollapsed}
        aria-expanded={!isCollapsed}
        className="absolute bottom-4 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-text/70 transition-colors hover:bg-white/10"
      >
        <ChevronsLeftRight className="size-5" />
      </button>
    </aside>
  );
}
