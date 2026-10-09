import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

const { learning, optimizer } = vi.hoisted(() => ({
  learning: { runLearningCycle: vi.fn().mockResolvedValue({ ok: true }) },
  optimizer: {
    updateOptimizationStatus: vi.fn().mockResolvedValue({ route: "/app/x" }),
    guardrails: { isNonCriticalRoute: () => true },
  },
}));
vi.mock("@/lib/ai/learning", () => learning);
vi.mock("@/lib/ai/optimizer", () => optimizer);
vi.mock("@/lib/ai/policy", () => ({ isGovernanceEnabled: () => true }));

import { triggerLearningCycleAction } from "@/app/devtools/ai-learning/actions";
import { applyRecommendationAction, rejectRecommendationAction } from "@/app/devtools/ai-tuning/actions";
import { requirePlatformAdminPage } from "@/lib/devtools/require-platform-admin";

const getServerSessionMock = vi.mocked(getServerSession);
const attacker = { user: { id: "cuid_attacker", email: "owner@example.com" }, expires: "2099-01-01" };
const admin = { user: { id: "cuid_admin", email: "a@example.com" }, expires: "2099-01-01" };

describe("platform-admin gate on server actions and admin pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("server actions reject non-admins and anonymous callers", async () => {
    for (const session of [attacker, null]) {
      getServerSessionMock.mockResolvedValue(session);
      await expect(triggerLearningCycleAction()).rejects.toThrow("Forbidden");
      await expect(applyRecommendationAction("1")).rejects.toThrow("Forbidden");
      await expect(rejectRecommendationAction("1")).rejects.toThrow("Forbidden");
    }
    expect(learning.runLearningCycle).not.toHaveBeenCalled();
    expect(optimizer.updateOptimizationStatus).not.toHaveBeenCalled();
  });

  it("server actions run for a listed admin id", async () => {
    getServerSessionMock.mockResolvedValue(admin);
    await expect(triggerLearningCycleAction()).resolves.toEqual({ ok: true });
    await expect(rejectRecommendationAction("1")).resolves.toBeDefined();
  });

  it("tuning actions record the session user id as actor, not a client value", async () => {
    getServerSessionMock.mockResolvedValue(admin);
    await applyRecommendationAction("rec_9");
    await rejectRecommendationAction("rec_9");

    for (const call of optimizer.updateOptimizationStatus.mock.calls) {
      expect(call[2]).toMatchObject({ actor: "cuid_admin" });
    }
    expect(optimizer.updateOptimizationStatus).toHaveBeenCalledTimes(2);
  });

  it("requirePlatformAdminPage redirects anonymous to login and non-admins to /app", async () => {
    getServerSessionMock.mockResolvedValue(null);
    await expect(requirePlatformAdminPage()).rejects.toThrow("NEXT_REDIRECT:/auth/login");

    getServerSessionMock.mockResolvedValue(attacker);
    await expect(requirePlatformAdminPage()).rejects.toThrow("NEXT_REDIRECT:/app");

    getServerSessionMock.mockResolvedValue(admin);
    await expect(requirePlatformAdminPage()).resolves.toBe(admin);
  });
});
