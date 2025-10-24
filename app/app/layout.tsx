import type { ReactNode } from "react";

import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

type AppLayoutProps = {
  children: ReactNode;
};

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0E1016] pb-12 text-[#F3F4F6]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-70 mix-blend-screen">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.22),_transparent_58%),_radial-gradient(circle_at_bottom,_rgba(34,211,238,0.15),_transparent_52%)]" />
        </div>
        <div className="absolute inset-0 bg-diagonal-grid opacity-40" aria-hidden />
      </div>

      <Topbar title="Dashboard" />

      <div className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 pb-16 pt-16 lg:flex-row lg:gap-12">
        <Sidebar />
        <main className="relative z-[1] flex-1 pb-16 lg:pb-24">{children}</main>
      </div>
    </div>
  );
}
