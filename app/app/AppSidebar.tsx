"use client";

import { type ComponentType, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { LogOut, Palette, Sparkles, SunMoon, UserCircle2 } from "lucide-react";
import { BarChart3, FilePenLine, LayoutDashboard, PanelLeftClose, PanelRightOpen } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/auth/SignOutButton";

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

const isActivePath = (pathname: string, target: string) => {
  if (pathname === target) {
    return true;
  }

  if (target === "/app/dashboard" && (pathname === "/app" || pathname === "/app/dashboard")) {
    return true;
  }

  return pathname.startsWith(`${target}/`);
};

const variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
};

export const AppSidebar = () => {
  const pathname = usePathname();
  const sessionResult = useSession();
  const session = sessionResult?.data;
  const [collapsed, setCollapsed] = useState(false);

  const userName = useMemo(
    () => session?.user?.name ?? session?.user?.email ?? "Pengguna InvoSmart",
    [session?.user?.email, session?.user?.name],
  );

  const initials = useMemo(() => {
    return userName
      .split(" ")
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [userName]);

  return (
    <aside
      className={`relative z-[2] transition-[width] duration-300 ease-out ${
        collapsed ? "w-full lg:w-[92px]" : "w-full lg:w-[288px]"
      }`}
    >
      <div
        className={`glass-surface relative flex h-full min-h-[640px] flex-col overflow-hidden rounded-3xl border border-[rgba(255,255,255,0.06)] p-6 shadow-[0_32px_80px_rgba(8,10,16,0.45)] backdrop-blur-xl ${
          collapsed ? "items-center" : "items-stretch"
        }`}
      >
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          <Link
            href="/app/dashboard"
            className={`flex items-center gap-2 text-base font-semibold tracking-tight text-text transition-transform ${
              collapsed ? "scale-105" : "text-lg"
            }`}
            aria-label="Kembali ke dashboard"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[rgba(var(--color-primary)_/_0.18)] text-sm font-bold text-text shadow-[0_10px_30px_rgba(var(--color-primary)_/_0.32)]">
              IS
            </span>
            {!collapsed ? <span>InvoSmart</span> : null}
          </Link>

          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Perluas navigasi" : "Ciutkan navigasi"}
            className="hidden rounded-xl border border-white/10 bg-white/5 p-2 text-text/70 transition hover:bg-white/10 hover:text-text lg:inline-flex"
          >
            {collapsed ? (
              <PanelRightOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </motion.button>
        </div>

        {!collapsed ? (
          <p className="mt-4 text-xs uppercase tracking-[0.32em] text-text/50">
            Navigasi utama
          </p>
        ) : null}

        <nav aria-label="Navigasi aplikasi" className="mt-6 flex-1">
          <ul className="flex flex-col gap-2">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href);
              const Icon = item.icon;

              return (
                <motion.li
                  key={item.href}
                  variants={variants}
                  initial="hidden"
                  animate="visible"
                  transition={{ duration: 0.28, ease: "easeOut" }}
                >
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-white/5 px-4 py-3 text-sm font-medium transition-all duration-300 hover:border-white/20 hover:bg-white/[0.08] ${
                      active
                        ? "bg-white/[0.08] text-text shadow-[0_15px_50px_rgba(var(--color-primary)_/_0.35)]"
                        : "text-text/80"
                    } ${collapsed ? "justify-center px-3" : ""}`}
                  >
                    {active ? (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-y-2 left-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-accent"
                      />
                    ) : null}
                    <span
                      className={`relative inline-flex h-9 w-9 flex-none items-center justify-center rounded-2xl border border-white/5 bg-white/[0.04] text-text/80 shadow-[0_10px_40px_rgba(8,10,16,0.45)] ${
                        active ? "text-text" : ""
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {!collapsed ? (
                      <span className="relative flex-1 text-left">
                        <span className="block text-sm font-medium text-text">{item.label}</span>
                        <span className="mt-1 block text-xs text-text/60">{item.description}</span>
                      </span>
                    ) : null}
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        </nav>

        <div className={`mt-6 flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.04] p-4 text-text/80 ${collapsed ? "flex-col" : ""}`}>
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-sm font-semibold text-text shadow-[0_12px_30px_rgba(var(--color-primary)_/_0.4)]">
            {initials || "IS"}
          </span>
          {!collapsed ? (
            <div className="flex-1">
              <p className="text-sm font-semibold text-text">{userName}</p>
              {session?.user?.email ? (
                <p className="text-xs text-text/60">{session.user.email}</p>
              ) : null}
              <p className="mt-2 text-[10px] uppercase tracking-[0.42em] text-text/40">
                InvoSmart v0.5
              </p>
            </div>
          ) : null}
          {!collapsed ? (
            <SignOutButton className="gradient-button inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-text shadow-lg shadow-primary-glow transition duration-200 hover:scale-[1.01]">
              <LogOut className="h-4 w-4" />
              Keluar
            </SignOutButton>
          ) : (
            <SignOutButton className="gradient-button inline-flex h-10 w-10 items-center justify-center rounded-2xl p-0 text-text shadow-lg">
              <LogOut className="h-4 w-4" />
            </SignOutButton>
          )}
        </div>
      </div>
    </aside>
  );
};

