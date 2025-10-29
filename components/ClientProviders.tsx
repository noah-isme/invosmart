"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";

import { TelemetryProvider } from "@/components/telemetry/TelemetryProvider";
import { AiOptimizerProvider } from "@/context/AiOptimizerContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <TelemetryProvider>
        <ThemeProvider>
          <AiOptimizerProvider>
            <ToastProvider>{children}</ToastProvider>
          </AiOptimizerProvider>
        </ThemeProvider>
      </TelemetryProvider>
    </SessionProvider>
  );
}
