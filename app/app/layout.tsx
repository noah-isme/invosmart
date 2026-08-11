"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Menu, X } from "lucide-react";

import ClientRoot from "@/components/ClientRoot";
import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "@/components/layout/BottomNav";

type AppLayoutProps = {
  children: ReactNode;
};

export default function AppLayout({ children }: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <ClientRoot>
      <div className="relative flex min-h-screen bg-bg">
        {/* Mobile Header with Hamburger */}
        <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-white/5 bg-bg/80 px-4 backdrop-blur-md md:hidden">
          <span className="text-sm font-bold text-text">InvoSmart</span>
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 text-text/70"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {/* Backdrop for mobile sidebar */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div
          className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Close button for mobile inside sidebar */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="absolute right-4 top-4 z-50 rounded-lg p-2 text-text/70 md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          
          <AppSidebar onNavClick={() => setMobileMenuOpen(false)} />
        </div>

        <main className="flex-1 pt-14 md:pt-0 pb-20 md:pb-0 min-h-screen overflow-x-hidden">
          <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
            {children}
          </div>
        </main>
        
        <BottomNav />
      </div>
    </ClientRoot>
  );
}
