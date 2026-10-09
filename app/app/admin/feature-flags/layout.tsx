import type { ReactNode } from "react";

import { requirePlatformAdminPage } from "@/lib/devtools/require-platform-admin";

// The page is a client component that reads global data through a
// platform-admin-gated API; this layout keeps non-admins off the page itself.
export default async function PlatformAdminSectionLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdminPage();
  return <>{children}</>;
}
