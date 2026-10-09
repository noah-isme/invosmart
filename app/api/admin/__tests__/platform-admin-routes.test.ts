import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/tracing", () => ({
  withSpan: (_name: string, handler: unknown) => handler,
}));

const { featureFlags, uptime, loop, orchestrator, workspaces } = vi.hoisted(() => ({
  featureFlags: {
    getAllFlags: vi.fn().mockResolvedValue([]),
    toggleFlag: vi.fn().mockResolvedValue({ id: "ff-1", enabled: false }),
    upsertFlag: vi.fn().mockResolvedValue({ id: "ff-2" }),
    deleteFlag: vi.fn().mockResolvedValue({}),
  },
  uptime: {
    getUptimeHistory: vi.fn().mockResolvedValue([]),
    getUptime24hStats: vi.fn().mockResolvedValue([]),
    runUptimeChecks: vi.fn().mockResolvedValue([]),
  },
  loop: {
    getLoopState: vi.fn().mockResolvedValue({}),
    startAutonomyLoop: vi.fn().mockResolvedValue(undefined),
    stopAutonomyLoop: vi.fn(),
  },
  orchestrator: {
    isOrchestrationEnabled: vi.fn().mockReturnValue(true),
    getOrchestratorSnapshot: vi.fn().mockResolvedValue({ agents: [], events: [] }),
    resolveConflict: vi.fn(),
  },
  workspaces: {
    resolveWorkspaceContextForRequest: vi.fn().mockResolvedValue({ role: "OWNER", organizationId: "org-1" }),
    canReadWorkspace: vi.fn().mockReturnValue(true),
    hasWorkspacePermission: vi.fn().mockReturnValue(true),
  },
}));

vi.mock("@/lib/feature-flags", () => featureFlags);
vi.mock("@/lib/monitoring/uptime", () => uptime);
vi.mock("@/lib/ai/loop", () => loop);
vi.mock("@/lib/ai/orchestrator", () => orchestrator);
vi.mock("@/lib/workspaces", () => workspaces);
vi.mock("@/lib/ai/federationAgent", () => ({
  getFederationAgent: () => ({
    broadcastLocalSnapshot: vi.fn(),
    getSnapshots: () => [],
    getTrustHistory: () => [],
    getModelHistory: () => [],
  }),
}));
vi.mock("@/lib/federation/bus", () => ({
  federationBus: { isEnabled: false, checkConnections: vi.fn(), getStatus: () => ({}) },
}));

import * as featureFlagsRoute from "@/app/api/admin/feature-flags/route";
import * as uptimeRoute from "@/app/api/admin/uptime/route";
import * as autonomyRoute from "@/app/api/devtools/autonomy/route";
import * as orchestratorRoute from "@/app/api/ai/orchestrator/route";
import * as perfRoute from "@/app/api/dev/perf/summary/route";
import * as federationRoute from "@/app/api/federation/status/route";

const getServerSessionMock = vi.mocked(getServerSession);

// An attacker who registered an address that appears in the (deprecated)
// ADMIN_EMAILS allowlist: valid session, workspace OWNER of a personal
// workspace, but not a platform admin.
const attacker = {
  user: { id: "cuid_registered_attacker", email: "owner@example.com" },
  expires: "2099-01-01",
};
const admin = { user: { id: "cuid_admin", email: "real-admin@example.com" }, expires: "2099-01-01" };

const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost${path}`, init);
const json = (path: string, method: string, body: unknown) =>
  req(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("platform-admin gate on admin/devtools API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv("FEDERATION_TOKEN_SECRET", "fed-secret");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    orchestrator.isOrchestrationEnabled.mockReturnValue(true);
    workspaces.resolveWorkspaceContextForRequest.mockResolvedValue({ role: "OWNER", organizationId: "org-1" });
    getServerSessionMock.mockResolvedValue(attacker);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("non-admin with an ADMIN_EMAILS-listed email gets 403", () => {
    it("GET /api/admin/uptime", async () => {
      const res = await uptimeRoute.GET(req("/api/admin/uptime"));
      expect(res.status).toBe(403);
      expect(uptime.getUptimeHistory).not.toHaveBeenCalled();
    });

    it("POST /api/admin/uptime", async () => {
      const res = await uptimeRoute.POST(json("/api/admin/uptime", "POST", {}));
      expect(res.status).toBe(403);
      expect(uptime.runUptimeChecks).not.toHaveBeenCalled();
    });

    it("GET /api/admin/feature-flags", async () => {
      const res = await featureFlagsRoute.GET();
      expect(res.status).toBe(403);
      expect(featureFlags.getAllFlags).not.toHaveBeenCalled();
    });

    it("POST/PUT/DELETE /api/admin/feature-flags cannot mutate GLOBAL flags even as workspace OWNER", async () => {
      const post = await featureFlagsRoute.POST(
        json("/api/admin/feature-flags", "POST", { id: "ff-1", enabled: false }),
      );
      const put = await featureFlagsRoute.PUT(
        json("/api/admin/feature-flags", "PUT", { key: "k", name: "n" }),
      );
      const del = await featureFlagsRoute.DELETE(
        req("/api/admin/feature-flags?id=ff-1", { method: "DELETE" }),
      );

      expect([post.status, put.status, del.status]).toEqual([403, 403, 403]);
      expect(featureFlags.toggleFlag).not.toHaveBeenCalled();
      expect(featureFlags.upsertFlag).not.toHaveBeenCalled();
      expect(featureFlags.deleteFlag).not.toHaveBeenCalled();
      expect(workspaces.hasWorkspacePermission).not.toHaveBeenCalled();
    });

    it("POST /api/devtools/autonomy", async () => {
      const res = await autonomyRoute.POST(json("/api/devtools/autonomy", "POST", { action: "pause" }));
      expect(res.status).toBe(403);
      expect(loop.stopAutonomyLoop).not.toHaveBeenCalled();
    });

    it("GET /api/ai/orchestrator", async () => {
      const res = await orchestratorRoute.GET(req("/api/ai/orchestrator"));
      expect(res.status).toBe(403);
      expect(orchestrator.getOrchestratorSnapshot).not.toHaveBeenCalled();
    });

    it("GET /api/dev/perf/summary", async () => {
      const res = await perfRoute.GET(req("/api/dev/perf/summary"));
      expect(res.status).toBe(403);
    });

    it("GET /api/federation/status (wrong bearer, non-admin session)", async () => {
      const res = await federationRoute.GET(req("/api/federation/status", { headers: { authorization: "Bearer nope" } }));
      expect(res.status).toBe(403);
    });
  });

  describe("unauthenticated callers are rejected", () => {
    it("returns 401/403 with no session", async () => {
      getServerSessionMock.mockResolvedValue(null);

      expect((await uptimeRoute.GET(req("/api/admin/uptime"))).status).toBe(401);
      expect((await featureFlagsRoute.GET()).status).toBe(401);
      expect((await autonomyRoute.POST(json("/api/devtools/autonomy", "POST", { action: "pause" }))).status).toBe(403);
      expect((await orchestratorRoute.GET(req("/api/ai/orchestrator"))).status).toBe(403);
    });
  });

  describe("an id listed in ADMIN_USER_IDS is allowed", () => {
    beforeEach(() => {
      getServerSessionMock.mockResolvedValue(admin);
    });

    it("uptime", async () => {
      expect((await uptimeRoute.GET(req("/api/admin/uptime"))).status).toBe(200);
    });

    it("feature flags (no workspace role required)", async () => {
      workspaces.resolveWorkspaceContextForRequest.mockResolvedValue(null);
      expect((await featureFlagsRoute.GET()).status).toBe(200);
      const res = await featureFlagsRoute.POST(
        json("/api/admin/feature-flags", "POST", { id: "ff-1", enabled: false }),
      );
      expect(res.status).toBe(200);
      expect(featureFlags.toggleFlag).toHaveBeenCalledWith("ff-1", false);
    });

    it("autonomy, orchestrator, perf summary", async () => {
      expect((await autonomyRoute.POST(json("/api/devtools/autonomy", "POST", { action: "pause" }))).status).toBe(200);
      expect((await orchestratorRoute.GET(req("/api/ai/orchestrator"))).status).toBe(200);
      expect((await perfRoute.GET(req("/api/dev/perf/summary"))).status).toBe(200);
    });
  });
});
