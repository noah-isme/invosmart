import { OptimizationStatus, type OptimizationLog } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

import { db } from "@/lib/db";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export type RollbackResult = {
  id: string;
  route: string;
  status: OptimizationStatus;
  message: string;
};

export const processAutoRollback = async (
  logs: OptimizationLog[],
  compositeImpact: number,
  { threshold = -0.05 }: { threshold?: number } = {},
): Promise<RollbackResult[]> => {
  if (!logs.length) return [];
  const normalizedThreshold = clamp(threshold, -1, 0);
  if (compositeImpact > normalizedThreshold) {
    return [];
  }

  const message = `Auto rollback triggered for ${logs.length} optimization(s); composite impact ${(
    compositeImpact * 100
  ).toFixed(2)}%`;

  const captureMessage = (Sentry as unknown as { captureMessage?: (msg: string, context?: unknown) => void }).captureMessage;
  captureMessage?.(message, {
    level: "info",
    extra: {
      logs: logs.map((log) => ({ id: log.id, route: log.route, status: log.status })),
      compositeImpact,
    },
  });

  const updated = await Promise.all(
    logs.map((log) =>
      db.optimizationLog.update({
        where: { id: log.id },
        data: {
          status: OptimizationStatus.REJECTED,
          rollback: true,
          notes: `${log.notes ?? ""}\nAuto rollback at ${new Date().toISOString()} (impact ${(compositeImpact * 100).toFixed(2)}%)`.trim(),
        },
      }),
    ),
  );

  return updated.map((log) => ({
    id: log.id,
    route: log.route,
    status: log.status,
    message,
  }));
};
