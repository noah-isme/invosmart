import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

type UptimeCheckMock = {
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
};

const { uptimeCheckMock } = vi.hoisted(() => ({
  uptimeCheckMock: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  } as UptimeCheckMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    uptimeCheck: uptimeCheckMock,
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/ai/webhooks", () => ({
  dispatchWebhookAlert: vi.fn().mockResolvedValue({ discord: { ok: true } }),
}));

import { dispatchWebhookAlert } from "@/lib/ai/webhooks";
import {
  DEFAULT_ENDPOINTS,
  checkEndpoint,
  getUptime24hStats,
  getUptimeHistory,
  resolveTargetUrl,
  runUptimeChecks,
} from "@/lib/monitoring/uptime";

import { GET as getHealth } from "@/app/api/health/route";
import { GET as getAdminUptime, POST as postAdminUptime } from "@/app/api/admin/uptime/route";
import { GET as getCronUptime, POST as postCronUptime } from "@/app/api/cron/uptime/route";

const getServerSessionMock = vi.mocked(getServerSession);
const dispatchWebhookAlertMock = vi.mocked(dispatchWebhookAlert);

describe("Milestone M6: Uptime Monitoring", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Health Check Endpoint (/api/health)", () => {
    it("returns HTTP 200 with status 'ok' and an ISO timestamp", async () => {
      const response = await getHealth();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveProperty("status", "ok");
      expect(body).toHaveProperty("timestamp");
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe("Uptime Monitoring Module (lib/monitoring/uptime.ts)", () => {
    describe("resolveTargetUrl", () => {
      it("preserves absolute HTTP/HTTPS URLs", () => {
        expect(resolveTargetUrl("http://example.com/health")).toBe("http://example.com/health");
        expect(resolveTargetUrl("https://api.domain.org/v1")).toBe("https://api.domain.org/v1");
      });

      it("resolves relative path URLs against default or NEXTAUTH_URL base", () => {
        process.env.NEXTAUTH_URL = "http://localhost:3000";
        expect(resolveTargetUrl("/api/health")).toBe("http://localhost:3000/api/health");
        expect(resolveTargetUrl("api/invoices")).toBe("http://localhost:3000/api/invoices");
      });
    });

    describe("checkEndpoint", () => {
      it("records status UP when endpoint returns HTTP 200 and does NOT trigger webhook alert", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
        });
        vi.stubGlobal("fetch", mockFetch);

        const createdDbRecord = {
          id: "check_1",
          url: "http://localhost:3000/api/health",
          name: "Health API",
          statusCode: 200,
          latencyMs: 15,
          status: "UP",
          error: null,
          createdAt: new Date(),
        };
        uptimeCheckMock.create.mockResolvedValue(createdDbRecord);

        const result = await checkEndpoint("http://localhost:3000/api/health", "Health API");

        expect(result.status).toBe("UP");
        expect(result.statusCode).toBe(200);
        expect(result.error).toBeNull();
        expect(uptimeCheckMock.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            url: "http://localhost:3000/api/health",
            name: "Health API",
            statusCode: 200,
            status: "UP",
            error: null,
          }),
        });
        expect(dispatchWebhookAlertMock).not.toHaveBeenCalled();
      });

      it("records status DOWN and dispatches webhook alert when endpoint returns HTTP 500", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          status: 500,
          ok: false,
        });
        vi.stubGlobal("fetch", mockFetch);

        const createdDbRecord = {
          id: "check_2",
          url: "http://localhost:3000/api/failing",
          name: "http://localhost:3000/api/failing",
          statusCode: 500,
          latencyMs: 25,
          status: "DOWN",
          error: "HTTP status 500",
          createdAt: new Date(),
        };
        uptimeCheckMock.create.mockResolvedValue(createdDbRecord);

        const result = await checkEndpoint("http://localhost:3000/api/failing");

        expect(result.status).toBe("DOWN");
        expect(result.statusCode).toBe(500);
        expect(result.error).toBe("HTTP status 500");
        expect(uptimeCheckMock.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            url: "http://localhost:3000/api/failing",
            statusCode: 500,
            status: "DOWN",
            error: "HTTP status 500",
          }),
        });

        expect(dispatchWebhookAlertMock).toHaveBeenCalledWith(
          expect.objectContaining({
            actionType: "UPTIME_ALERT",
            status: "triggered",
            confidence: 1.0,
            reason: expect.stringContaining("Endpoint http://localhost:3000/api/failing returned status 500"),
          })
        );
      });

      it("records status DOWN and dispatches webhook alert when fetch throws network error", async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
        vi.stubGlobal("fetch", mockFetch);

        uptimeCheckMock.create.mockResolvedValue({
          id: "check_3",
          url: "http://localhost:3000/api/down",
          name: "http://localhost:3000/api/down",
          statusCode: 0,
          latencyMs: 5,
          status: "DOWN",
          error: "Connection refused",
          createdAt: new Date(),
        });

        const result = await checkEndpoint("http://localhost:3000/api/down");

        expect(result.status).toBe("DOWN");
        expect(result.statusCode).toBe(0);
        expect(result.error).toBe("Connection refused");
        expect(dispatchWebhookAlertMock).toHaveBeenCalledWith(
          expect.objectContaining({
            actionType: "UPTIME_ALERT",
            status: "triggered",
            reason: expect.stringContaining("Connection refused"),
          })
        );
      });
    });

    describe("runUptimeChecks", () => {
      it("executes uptime checks for default endpoints when no custom list provided", async () => {
        const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
        vi.stubGlobal("fetch", mockFetch);
        uptimeCheckMock.create.mockResolvedValue({ id: "check_def", status: "UP" });

        const results = await runUptimeChecks();

        expect(results.length).toBe(DEFAULT_ENDPOINTS.length);
        expect(mockFetch).toHaveBeenCalledTimes(DEFAULT_ENDPOINTS.length);
      });

      it("executes uptime checks for specified list of endpoints", async () => {
        const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
        vi.stubGlobal("fetch", mockFetch);
        uptimeCheckMock.create.mockResolvedValue({ id: "check_cust", status: "UP" });

        const customUrls = ["http://localhost:3000/api/health"];
        const results = await runUptimeChecks(customUrls);

        expect(results.length).toBe(1);
        expect(results[0].url).toBe("http://localhost:3000/api/health");
      });
    });

    describe("getUptimeHistory", () => {
      it("queries db.uptimeCheck.findMany with order desc and specified limit", async () => {
        const mockHistory = [
          { id: "1", url: "http://localhost:3000/api/health", statusCode: 200, latencyMs: 10, status: "UP", createdAt: new Date() },
        ];
        uptimeCheckMock.findMany.mockResolvedValue(mockHistory);

        const history = await getUptimeHistory(20);

        expect(history).toEqual(mockHistory);
        expect(uptimeCheckMock.findMany).toHaveBeenCalledWith({
          orderBy: { createdAt: "desc" },
          take: 20,
        });
      });
    });

    describe("getUptime24hStats", () => {
      it("aggregates 24h metrics per endpoint correctly", async () => {
        const now = new Date();
        const mockChecks = [
          { id: "1", url: "http://localhost:3000/api/health", name: "Health API", statusCode: 200, latencyMs: 10, status: "UP", createdAt: now },
          { id: "2", url: "http://localhost:3000/api/health", name: "Health API", statusCode: 200, latencyMs: 30, status: "UP", createdAt: new Date(now.getTime() - 1000) },
          { id: "3", url: "http://localhost:3000/api/health", name: "Health API", statusCode: 500, latencyMs: 50, status: "DOWN", createdAt: new Date(now.getTime() - 2000) },
        ];

        uptimeCheckMock.findMany.mockResolvedValue(mockChecks);

        const stats = await getUptime24hStats();
        const healthStat = stats.find((s) => s.url === "http://localhost:3000/api/health");

        expect(healthStat).toBeDefined();
        expect(healthStat?.currentStatus).toBe("UP");
        expect(healthStat?.latestStatusCode).toBe(200);
        expect(healthStat?.totalChecks).toBe(3);
        expect(healthStat?.uptimePercentage).toBe(66.7);
        expect(healthStat?.avgLatencyMs).toBe(30); // (10 + 30 + 50) / 3 = 30
      });
    });
  });

  describe("Admin Uptime API Routes (/api/admin/uptime)", () => {
    describe("GET /api/admin/uptime", () => {
      it("returns 401 Unauthorized when session is missing", async () => {
        getServerSessionMock.mockResolvedValue(null);

        const req = new NextRequest("http://localhost:3000/api/admin/uptime");
        const res = await getAdminUptime(req);
        const body = await res.json();

        expect(res.status).toBe(401);
        expect(body).toEqual({ error: "Unauthorized" });
      });

      it("returns history and stats when user is authenticated", async () => {
        getServerSessionMock.mockResolvedValue({
          user: { id: "admin_1", email: "admin@invosmart.id" },
        });

        uptimeCheckMock.findMany.mockResolvedValue([]);

        const req = new NextRequest("http://localhost:3000/api/admin/uptime");
        const res = await getAdminUptime(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toHaveProperty("history");
        expect(body).toHaveProperty("stats");
      });
    });

    describe("POST /api/admin/uptime", () => {
      it("returns 401 Unauthorized when session is missing", async () => {
        getServerSessionMock.mockResolvedValue(null);

        const req = new NextRequest("http://localhost:3000/api/admin/uptime", {
          method: "POST",
          body: JSON.stringify({}),
        });
        const res = await postAdminUptime(req);
        const body = await res.json();

        expect(res.status).toBe(401);
        expect(body).toEqual({ error: "Unauthorized" });
      });

      it("triggers check and returns updated results and stats when authenticated", async () => {
        getServerSessionMock.mockResolvedValue({
          user: { id: "admin_1", email: "admin@invosmart.id" },
        });

        const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
        vi.stubGlobal("fetch", mockFetch);
        uptimeCheckMock.create.mockResolvedValue({ id: "check_post", status: "UP" });
        uptimeCheckMock.findMany.mockResolvedValue([]);

        const req = new NextRequest("http://localhost:3000/api/admin/uptime", {
          method: "POST",
          body: JSON.stringify({ endpoints: ["http://localhost:3000/api/health"] }),
        });
        const res = await postAdminUptime(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toHaveProperty("message", "Uptime check executed successfully");
        expect(body).toHaveProperty("results");
        expect(body).toHaveProperty("history");
        expect(body).toHaveProperty("stats");
      });
    });
  });

  describe("Uptime Cron API Route (/api/cron/uptime)", () => {
    describe("GET /api/cron/uptime", () => {
      it("invokes runUptimeChecks and returns 200 with summary and results", async () => {
        const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
        vi.stubGlobal("fetch", mockFetch);
        uptimeCheckMock.create.mockResolvedValue({ id: "cron_check_1", status: "UP" });

        const req = new NextRequest("http://localhost:3000/api/cron/uptime");
        const res = await getCronUptime(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toHaveProperty("success", true);
        expect(body).toHaveProperty("timestamp");
        expect(body).toHaveProperty("summary");
        expect(body.summary).toHaveProperty("total");
        expect(body.summary).toHaveProperty("up");
        expect(body.summary).toHaveProperty("down");
        expect(body).toHaveProperty("results");
        expect(Array.isArray(body.results)).toBe(true);
      });

      it("triggers webhook alert on failure and returns down summary count", async () => {
        const mockFetch = vi.fn().mockResolvedValue({ status: 500, ok: false });
        vi.stubGlobal("fetch", mockFetch);
        uptimeCheckMock.create.mockResolvedValue({ id: "cron_check_fail", status: "DOWN" });

        const req = new NextRequest("http://localhost:3000/api/cron/uptime?endpoints=http://localhost:3000/api/health");
        const res = await getCronUptime(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.summary.down).toBeGreaterThan(0);
        expect(dispatchWebhookAlertMock).toHaveBeenCalledWith(
          expect.objectContaining({
            actionType: "UPTIME_ALERT",
            status: "triggered",
          })
        );
      });

      it("enforces CRON_SECRET authorization when process.env.CRON_SECRET is set", async () => {
        process.env.CRON_SECRET = "supersecretcronkey";

        const reqUnauthorized = new NextRequest("http://localhost:3000/api/cron/uptime");
        const resUnauthorized = await getCronUptime(reqUnauthorized);
        expect(resUnauthorized.status).toBe(401);

        const reqAuthorized = new NextRequest("http://localhost:3000/api/cron/uptime", {
          headers: { authorization: "Bearer supersecretcronkey" },
        });
        const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
        vi.stubGlobal("fetch", mockFetch);
        uptimeCheckMock.create.mockResolvedValue({ id: "cron_check_sec", status: "UP" });

        const resAuthorized = await getCronUptime(reqAuthorized);
        expect(resAuthorized.status).toBe(200);
      });
    });

    describe("POST /api/cron/uptime", () => {
      it("accepts endpoints array in body and executes checks", async () => {
        const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
        vi.stubGlobal("fetch", mockFetch);
        uptimeCheckMock.create.mockResolvedValue({ id: "cron_post_1", status: "UP" });

        const req = new NextRequest("http://localhost:3000/api/cron/uptime", {
          method: "POST",
          body: JSON.stringify({ endpoints: ["http://localhost:3000/api/health"] }),
        });
        const res = await postCronUptime(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.results.length).toBe(1);
        expect(body.results[0].url).toBe("http://localhost:3000/api/health");
      });
    });
  });
});
