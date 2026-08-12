import { db } from "@/lib/db";
import { dispatchWebhookAlert } from "@/lib/ai/webhooks";

export const DEFAULT_ENDPOINTS = [
  "http://localhost:3000/api/health",
  "http://localhost:3000/api/invoices",
];

export function resolveTargetUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || "http://localhost:3000";
  const cleanBase = baseUrl.startsWith("http") ? baseUrl : `http://${baseUrl}`;
  return `${cleanBase.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type UptimeCheckResult = {
  id?: string;
  url: string;
  name: string;
  statusCode: number;
  latencyMs: number;
  status: "UP" | "DOWN";
  error: string | null;
  createdAt: Date;
};

export async function checkEndpoint(
  url: string,
  name?: string
): Promise<UptimeCheckResult> {
  const fullUrl = resolveTargetUrl(url);
  const endpointName = name || url;
  const startTime = performance.now();

  let statusCode = 0;
  let status: "UP" | "DOWN" = "DOWN";
  let errorMsg: string | null = null;

  try {
    const response = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "User-Agent": "InvoSmart-Uptime-Monitor/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });

    statusCode = response.status;
    if (statusCode === 200) {
      status = "UP";
      errorMsg = null;
    } else {
      status = "DOWN";
      errorMsg = `HTTP status ${statusCode}`;
    }
  } catch (err: unknown) {
    statusCode = 0;
    status = "DOWN";
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = Math.max(0, Math.round(performance.now() - startTime));
  const checkTime = new Date();

  let savedRecord: { id?: string } | null = null;
  try {
    savedRecord = await db.uptimeCheck.create({
      data: {
        url,
        name: endpointName,
        statusCode,
        latencyMs,
        status,
        error: errorMsg,
        createdAt: checkTime,
      },
    });
  } catch (dbErr) {
    console.error("[UptimeCheck] Failed to save DB record:", dbErr);
  }

  if (status === "DOWN" || statusCode !== 200) {
    try {
      await dispatchWebhookAlert({
        actionType: "UPTIME_ALERT",
        reason: `Endpoint ${url} returned status ${statusCode}${errorMsg ? `: ${errorMsg}` : ""}`,
        confidence: 1.0,
        status: "triggered",
        createdAt: checkTime,
      });
    } catch (alertErr) {
      console.error("[UptimeCheck] Failed to dispatch webhook alert:", alertErr);
    }
  }

  return {
    id: savedRecord?.id || undefined,
    url,
    name: endpointName,
    statusCode,
    latencyMs,
    status,
    error: errorMsg,
    createdAt: checkTime,
  };
}

export async function runUptimeChecks(
  urls?: string[]
): Promise<UptimeCheckResult[]> {
  const targetUrls =
    urls && urls.length > 0
      ? urls
      : process.env.UPTIME_MONITORED_ENDPOINTS
      ? process.env.UPTIME_MONITORED_ENDPOINTS.split(",").map((s) => s.trim())
      : DEFAULT_ENDPOINTS;

  const results: UptimeCheckResult[] = [];
  for (const url of targetUrls) {
    const result = await checkEndpoint(url);
    results.push(result);
  }
  return results;
}

export async function getUptimeHistory(limit = 50) {
  try {
    return await db.uptimeCheck.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  } catch (err) {
    console.error("[UptimeCheck] Failed to query uptime history:", err);
    return [];
  }
}

export type Endpoint24hStat = {
  url: string;
  name: string;
  currentStatus: "UP" | "DOWN" | "UNKNOWN";
  latestStatusCode: number | null;
  latestLatencyMs: number;
  latestCheckAt: Date | null;
  uptimePercentage: number;
  avgLatencyMs: number;
  totalChecks: number;
  recentChecks: Array<{
    id?: string;
    statusCode: number;
    latencyMs: number;
    status: string;
    createdAt: Date;
  }>;
};

export async function getUptime24hStats(): Promise<Endpoint24hStat[]> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentChecks = await db.uptimeCheck.findMany({
      where: {
        createdAt: { gte: twentyFourHoursAgo },
      },
      orderBy: { createdAt: "desc" },
    });

    const map = new Map<string, typeof recentChecks>();
    for (const check of recentChecks) {
      const list = map.get(check.url) || [];
      list.push(check);
      map.set(check.url, list);
    }

    // Default monitored endpoints should appear even if no records yet
    const knownUrls = new Set([...DEFAULT_ENDPOINTS, ...Array.from(map.keys())]);

    const stats: Endpoint24hStat[] = [];
    for (const url of Array.from(knownUrls)) {
      const checks = map.get(url) || [];
      const total = checks.length;
      const upCount = checks.filter((c) => c.status === "UP").length;
      const avgLatency =
        total > 0
          ? Math.round(checks.reduce((sum, c) => sum + c.latencyMs, 0) / total)
          : 0;
      const latest = checks[0];

      stats.push({
        url,
        name: latest?.name || url,
        currentStatus: (latest?.status as "UP" | "DOWN") || "UNKNOWN",
        latestStatusCode: latest?.statusCode ?? null,
        latestLatencyMs: latest?.latencyMs ?? 0,
        latestCheckAt: latest?.createdAt ?? null,
        uptimePercentage: total > 0 ? Number(((upCount / total) * 100).toFixed(1)) : 100,
        avgLatencyMs: avgLatency,
        totalChecks: total,
        recentChecks: checks.slice(0, 20).map((c) => ({
          id: c.id,
          statusCode: c.statusCode,
          latencyMs: c.latencyMs,
          status: c.status,
          createdAt: c.createdAt,
        })),
      });
    }

    return stats;
  } catch (err) {
    console.error("[UptimeCheck] Failed to compute 24h stats:", err);
    return [];
  }
}
