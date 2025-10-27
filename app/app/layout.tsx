import type { ReactNode } from "react";

import ClientRoot from "@/components/ClientRoot";
import AppShell from "@/components/layout/AppShell";

type AppLayoutProps = {
  children: ReactNode;
};

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <ClientRoot>
      <AppShell>{children}</AppShell>
    </ClientRoot>
  );
}
