"use client";

import type { ReactNode } from "react";
import ClientProviders from "./ClientProviders";

export default function ClientRoot({ children }: { children: ReactNode }) {
  // This thin wrapper ensures server layouts import a single client entrypoint
  // and keeps provider wiring isolated to the client bundle.
  return <ClientProviders>{children}</ClientProviders>;
}
