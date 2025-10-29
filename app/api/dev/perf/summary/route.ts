import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { withSpan } from "@/lib/tracing";
import { authOptions } from "@/server/auth";
import { canViewPerfTools, getPerfToolsSampleRate } from "@/lib/devtools/access";

const ensureAuthorised = async () => {
  const session = await getServerSession(authOptions);

  return { session, authorised: canViewPerfTools(session) } as const;
};

const generateTimeseries = (routes: string[], end: Date, minutes: number) => {
  const slices = 6;
  const step = (minutes * 60 * 1000) / slices;
  const start = end.getTime() - minutes * 60 * 1000;

  const points: {
    route: string;
    timestamp: string;
    p50: number;
    p95: number;
  }[] = [];

  for (const route of routes) {
    for (let index = 0; index < slices; index += 1) {
      const timestamp = new Date(start + step * (index + 1));
      const routeSeed = route.length + index * 13;
      const baseline = 1800 + (routeSeed % 500);
      const variability = (routeSeed % 7) * 60;

      points.push({
        route,
        timestamp: timestamp.toISOString(),
        p50: Math.round(baseline + variability * 0.35),
        p95: Math.round(baseline + variability * 1.5 + 600),
      });
    }
  }

  return points;
};

const perfSummaryHandler = async (request: NextRequest) => {
  const { authorised } = await ensureAuthorised();

  if (!authorised) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const rangeParam = request.nextUrl?.searchParams?.get("range") ?? url.searchParams.get("range") ?? "24h";
  const minutes = rangeParam === "7d" ? 7 * 24 * 60 : rangeParam === "48h" ? 48 * 60 : 24 * 60;
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60 * 1000);
  const routes = ["/app/invoices", "/app/insight", "/app/invoices/ai"];

  const summary = {
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
      label: rangeParam,
    },
    sampleRate: getPerfToolsSampleRate(),
    metrics: {
      lcp: generateTimeseries(routes, end, minutes),
      inp: generateTimeseries(routes, end, minutes).map((entry) => ({
        ...entry,
        p50: Math.round(entry.p50 / 10),
        p95: Math.round(entry.p95 / 12),
      })),
      fcp: generateTimeseries(routes, end, minutes).map((entry) => ({
        ...entry,
        p50: Math.max(900, Math.round(entry.p50 * 0.55)),
        p95: Math.max(1500, Math.round(entry.p95 * 0.45)),
      })),
    },
    inpDistribution: [
      { bucket: "<200ms", count: 128 },
      { bucket: "200-400ms", count: 84 },
      { bucket: "400-600ms", count: 32 },
      { bucket: ">600ms", count: 9 },
    ],
    routeOutliers: [
      {
        route: "/app/invoices/[id]",
        metric: "LCP",
        p95: 3850,
        change: 12,
        samples: 28,
      },
      {
        route: "/app/invoices/ai",
        metric: "INP",
        p95: 320,
        change: -6,
        samples: 41,
      },
    ],
    slowApis: [
      { endpoint: "/api/invoices", method: "GET", p95: 412, p50: 210, volume: 884 },
      { endpoint: "/api/invoices/ai", method: "POST", p95: 982, p50: 640, volume: 143 },
      { endpoint: "/api/invoices/[id]/pdf", method: "GET", p95: 1280, p50: 720, volume: 96 },
      { endpoint: "/api/insight/revenue", method: "GET", p95: 360, p50: 188, volume: 412 },
    ],
    lastUpdated: end.toISOString(),
  } as const;

  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
};

export const GET = withSpan("api.dev.perf.summary", perfSummaryHandler, {
  op: "http.server",
  attributes: { "api.operation": "perf_summary" },
});

