import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prisma/client", () => ({
  OptimizationStatus: {
    PENDING: "PENDING",
    APPLIED: "APPLIED",
    REJECTED: "REJECTED",
  },
}));

import {
  fetchMetrics,
  generateOptimizationRecommendations,
  getLatestRecommendations,
  saveRecommendations,
} from "@/lib/ai/optimizer";

vi.mock("@/lib/db", () => {
  const create = vi.fn();
  const findMany = vi.fn();
  const update = vi.fn();
  (globalThis as Record<string, unknown>).__dbMocks = { create, findMany, update };
  return {
    db: {
      optimizationLog: {
        create,
        findMany,
        update,
      },
    },
  };
});

const dbMocks = (globalThis as { __dbMocks: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } }).__dbMocks;

type MockResponse = {
  ok: boolean;
  url: string;
  status: number;
  text: () => Promise<string>;
};

const createMockResponse = (data: unknown, ok = true): MockResponse => ({
  ok,
  url: "https://example.test/mock",
  status: ok ? 200 : 500,
  text: async () => JSON.stringify(data),
});

const chatCreateMock = vi.fn();

vi.mock("@/lib/ai", () => ({
  DEFAULT_MODEL: "test-model",
  createClient: () => ({
    chat: {
      completions: {
        create: chatCreateMock,
      },
    },
  }),
}));

describe("ai optimizer", () => {
  beforeEach(() => {
    chatCreateMock.mockReset();
    dbMocks.create.mockReset();
    dbMocks.findMany.mockReset();
  });

  afterEach(() => {
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_PROJECT_ID;
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_ORG_SLUG;
    delete process.env.SENTRY_PROJECT_SLUG;
  });

  it("merges PostHog and Sentry metrics", async () => {
    const fetchSpy = vi.spyOn(globalThis as { fetch: typeof fetch }, "fetch").mockResolvedValueOnce(
      createMockResponse({
        results: [
          { route: "/app/dashboard", lcpP95: 3200, inpP95: 140, apiLatencyP95: 420, count: 140 },
        ],
      }) as unknown as Response,
    );

    fetchSpy.mockResolvedValueOnce(
      createMockResponse({
        data: [{ route: "/app/dashboard", errorRate: 0.02 }],
      }) as unknown as Response,
    );

    process.env.POSTHOG_API_KEY = "ph_test";
    process.env.POSTHOG_PROJECT_ID = "123";
    process.env.SENTRY_AUTH_TOKEN = "sentry";
    process.env.SENTRY_ORG_SLUG = "org";
    process.env.SENTRY_PROJECT_SLUG = "proj";

    const metrics = await fetchMetrics({ intervalMinutes: 30 });
    expect(metrics).toEqual([
      {
        route: "/app/dashboard",
        lcpP95: 3200,
        inpP95: 140,
        apiLatencyP95: 420,
        errorRate: 0.02,
        sampleSize: 140,
      },
    ]);

    fetchSpy.mockRestore();
  });

  it("generates recommendations via AI response", async () => {
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '```json{"recommendations":[{"route":"/app/invoices","suggestion":"Optimalkan daftar invoice","impact":"Kurangi LCP","confidence":0.82}]}```',
          },
        },
      ],
    });

    const metrics = [
      {
        route: "/app/invoices",
        lcpP95: 3500,
        inpP95: 180,
        apiLatencyP95: 600,
        errorRate: 0.01,
        sampleSize: 120,
      },
    ];

    const recommendations = await generateOptimizationRecommendations(metrics);
    expect(recommendations).toEqual([
      {
        route: "/app/invoices",
        suggestion: "Optimalkan daftar invoice",
        impact: "Kurangi LCP",
        confidence: 0.82,
      },
    ]);
  });

  it("falls back to heuristic recommendations when AI output invalid", async () => {
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: { content: "not-json" },
        },
      ],
    });

    const metrics = [
      {
        route: "/app/help",
        lcpP95: 3600,
        inpP95: 120,
        apiLatencyP95: 300,
        errorRate: 0.01,
        sampleSize: 40,
      },
    ];

    const recommendations = await generateOptimizationRecommendations(metrics);
    expect(recommendations[0]?.route).toBe("/app/help");
    expect(recommendations[0]?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("persists recommendations to optimization log", async () => {
    dbMocks.create.mockResolvedValue({
      id: "rec1",
      route: "/app/dashboard",
      change: "Optimalkan hero",
      impact: "Kurangi LCP",
      confidence: 0.8,
      status: "PENDING",
      actor: "system",
      notes: null,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    });

    const records = await saveRecommendations([
      {
        route: "/app/dashboard",
        suggestion: "Optimalkan hero",
        impact: "Kurangi LCP",
        confidence: 0.8,
      },
      {
        route: "/api/secure",
        suggestion: "Should be filtered",
        impact: "",
        confidence: 0.9,
      },
    ]);

    expect(dbMocks.create).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ route: "/app/dashboard", status: "PENDING" });
  });

  it("returns pending recommendations", async () => {
    dbMocks.findMany.mockResolvedValue([
      {
        id: "rec1",
        route: "/app/invoices",
        change: "Prefetch detail",
        impact: "Kurangi latency",
        confidence: 0.9,
        status: "PENDING",
        actor: "system",
        notes: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
      },
    ]);

    const results = await getLatestRecommendations({ limit: 5 });
    expect(dbMocks.findMany).toHaveBeenCalledWith({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    expect(results[0]?.route).toBe("/app/invoices");
  });
});
