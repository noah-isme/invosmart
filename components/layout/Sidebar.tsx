"use client";

import {
  memo,
  type ComponentType,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  BarChart3,
  ChevronsLeftRight,
  FilePenLine,
  Info,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  LogOut,
  Palette,
  Sparkles,
  SunMoon,
  UserCircle2,
  Receipt,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { SignOutButton } from "@/components/auth/SignOutButton";

const WIDTH_EXPANDED = 280;
const WIDTH_COLLAPSED = 80;

const STORAGE_KEY = "invosmart.sidebar";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

type SidebarProps = {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
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
    href: "/app/insight",
    label: "AI Insights",
    description: "Insight finansial otomatis dari AI",
    icon: Lightbulb,
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
  {
    href: "/app/about",
    label: "Tentang",
    description: "Pelajari visi & roadmap InvoSmart",
    icon: Info,
  },
  {
    href: "/app/receipts",
    label: "Receipts",
    description: "Buat dan verifikasi tanda terima",
    icon: Receipt,
  },
  {
    href: "/app/help",
    label: "Bantuan",
    description: "FAQ dan dokumentasi API",
    icon: LifeBuoy,
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

type NavLinkProps = {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onNavigate: () => void;
};

const NavLink = memo(function NavLink({
  item,
  collapsed,
  active,
  onNavigate,
}: NavLinkProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      prefetch
      data-tooltip={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
        active
          ? "border-white/25 bg-white/15 text-text shadow-[0_0_18px_rgba(var(--color-primary)_/_0.28)]"
          : "text-text/70 hover:border-white/15 hover:bg-white/10 hover:text-text"
      } ${collapsed ? "lg:justify-center" : ""}`}
      onClick={onNavigate}
    >
      <span
        className={`flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/6 text-text/80 transition-all duration-150 ${
          active ? "text-text" : ""
        }`}
      >
        <Icon className="size-4" />
      </span>
      {!collapsed ? (
        <span className="flex flex-col overflow-hidden">
          <span className="truncate text-xs text-text">{item.label}</span>
          <span className="truncate text-[10px] text-text/50">{item.description}</span>
        </span>
      ) : null}
    </Link>
  );
});

export default function Sidebar({ isMobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const sessionResult = useSession();
  const session = sessionResult?.data;
  const [isCollapsed, setIsCollapsed] = useState(() => getInitialCollapsed());
  const collapsedForLayout = isCollapsed && !isMobileOpen;

  useEffect(() => {
    navItems.forEach((item) => {
      try {
        const result = router.prefetch(item.href);
        const maybePromise = result as unknown;
        if (
          typeof maybePromise === "object" &&
          maybePromise !== null &&
          "catch" in maybePromise &&
          typeof (maybePromise as { catch?: unknown }).catch === "function"
        ) {
          void (maybePromise as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        // ignore prefetch failures to avoid impacting navigation
      }
    });
  }, [router]);

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
    "--sidebar-width": `${collapsedForLayout ? WIDTH_COLLAPSED : WIDTH_EXPANDED}px`,
  } as CSSProperties;

  const toggle = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    }
  };

  const handleMobileNavigate = () => {
    if (onMobileClose) {
      onMobileClose();
    }
  };

  return (
    <aside
      aria-label="Navigasi utama"
      style={sidebarStyle}
      className={`group fixed inset-y-0 left-0 z-50 flex h-[calc(100vh-3.5rem)] w-[min(85vw,280px)] -translate-x-full flex-col overflow-hidden border border-white/15 bg-white/[0.08] pt-16 backdrop-blur-lg shadow-[0_12px_32px_rgba(0,0,0,0.28)] transition-transform duration-200 ease-out will-change-transform ${
        isMobileOpen ? "translate-x-0" : ""
      } lg:sticky lg:top-20 lg:h-[calc(100vh-5rem)] lg:w-[var(--sidebar-width)] lg:max-w-[280px] lg:translate-x-0 lg:rounded-3xl lg:border lg:bg-white/[0.07] lg:pt-0 lg:shadow-[0_10px_28px_rgba(0,0,0,0.18)] lg:transition-[width] lg:duration-200`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-3 pt-4 lg:pt-5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-xs font-semibold text-text shadow-primary-glow">
            {initials}
          </span>
          {!collapsedForLayout ? (
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-text">{session?.user?.name ?? "InvoSmart"}</p>
              {session?.user?.email ? (
                <p className="truncate text-[10px] text-text/60">{session?.user?.email}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <nav aria-label="Menu aplikasi" className="mt-4 flex-1 space-y-1 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsedForLayout}
              active={isActivePath(pathname, item.href)}
              onNavigate={handleMobileNavigate}
            />
          ))}
        </nav>

        <div className="mt-4 px-3 pb-16">
          <div
            className={`flex items-center gap-2 rounded-xl border border-white/10 bg-white/6 p-3 transition-colors duration-200 ${
              collapsedForLayout ? "lg:flex lg:flex-col lg:text-center" : "text-left"
            }`}
          >
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-xs font-semibold text-text shadow-accent-glow">
              {initials}
            </div>
            {!collapsedForLayout ? (
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-semibold text-text">
                  {session?.user?.name ?? session?.user?.email ?? "Pengguna InvoSmart"}
                </p>
                <p className="text-[10px] text-text/60">Akun aktif</p>
              </div>
            ) : null}
            <SignOutButton
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-medium text-text transition-all hover:bg-white/20 ${
                collapsedForLayout ? "lg:w-full lg:mt-2" : ""
              }`}
            >
              <LogOut className="size-3.5" />
              {!collapsedForLayout ? <span>Keluar</span> : null}
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
        className="absolute bottom-3 left-1/2 hidden h-9 w-9 -translate-x-1/2 items-center justify-center rounded-lg border border-white/10 bg-white/6 text-text/70 transition-colors hover:bg-white/10 lg:flex"
      >
        <ChevronsLeftRight className="size-4" />
      </button>
    </aside>
  );
}
