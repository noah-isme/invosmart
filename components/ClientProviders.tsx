"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";

import { TelemetryProvider } from "@/components/telemetry/TelemetryProvider";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <TelemetryProvider>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </TelemetryProvider>
    </SessionProvider>
  );
}
