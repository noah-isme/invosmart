'use client';

import { useCallback, useState, type ReactNode } from "react";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { PageTransition } from "./PageTransition";

type AppShellProps = {
  children: ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const toggleMobileNav = useCallback(() => {
    setIsMobileNavOpen((prev) => !prev);
  }, []);

  const closeMobileNav = useCallback(() => {
    setIsMobileNavOpen(false);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg pb-12 text-text transition-colors duration-200">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-70 mix-blend-screen">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.22),_transparent_58%),_radial-gradient(circle_at_bottom,_rgba(var(--color-accent)_/_0.15),_transparent_52%)]" />
        </div>
        <div className="absolute inset-0 bg-diagonal-grid opacity-40" aria-hidden />
      </div>

      <Topbar
        onToggleNavigation={toggleMobileNav}
        isNavigationOpen={isMobileNavOpen}
      />

      {isMobileNavOpen ? (
        <button
          type="button"
          aria-label="Tutup menu navigasi"
          onClick={closeMobileNav}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden"
        />
      ) : null}

      <div className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-16 pt-16 lg:flex-row lg:gap-6">
        <Sidebar isMobileOpen={isMobileNavOpen} onMobileClose={closeMobileNav} />
        <main
          className="relative z-[1] min-w-0 flex-1 pb-16 lg:pb-24"
          onClick={() => {
            if (isMobileNavOpen) {
              closeMobileNav();
            }
          }}
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
