import type { ReactNode } from "react";

import { AppSidebar } from "./AppSidebar";

type AppLayoutProps = {
  children: ReactNode;
};

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-950/95 pb-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 lg:flex-row lg:gap-10">
        <AppSidebar />
        <div className="flex-1 lg:pl-2">{children}</div>
      </div>
    </div>
  );
}

