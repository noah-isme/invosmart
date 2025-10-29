"use client";

import { useEffect } from "react";

import { initTelemetry } from "@/lib/telemetry";
import { initRUM } from "@/lib/rum";

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;

    const initialise = async () => {
      await initTelemetry();
      if (!cancelled) {
        await initRUM();
      }
    };

    void initialise();

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
