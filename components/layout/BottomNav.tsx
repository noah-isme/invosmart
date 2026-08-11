"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Receipt, UserCircle2 } from "lucide-react";

export function BottomNav() {
  const pathname = usePathname();

  const tabs = [
    { name: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
    { name: "Invoices", href: "/app/invoices/new", icon: FileText },
    { name: "Receipts", href: "/app/receipts", icon: Receipt },
    { name: "Profile", href: "/app/profile", icon: UserCircle2 },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex h-20 items-center justify-around border-t border-white/10 bg-bg/90 pb-safe px-2 backdrop-blur-lg md:hidden">
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href) || 
          (tab.href === "/app/dashboard" && pathname === "/app");

        const Icon = tab.icon;

        return (
          <Link
            key={tab.name}
            href={tab.href}
            className={`flex flex-col items-center justify-center gap-1 p-2 transition-colors ${
              isActive ? "text-indigo-500" : "text-text/50 hover:text-text/80"
            }`}
          >
            <Icon className={`h-6 w-6 ${isActive ? "text-indigo-500" : ""}`} />
            <span className="text-[10px] font-medium">{tab.name}</span>
          </Link>
        );
      })}
    </div>
  );
}
