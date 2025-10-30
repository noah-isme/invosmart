import { describe, expect, it, vi, beforeEach } from "vitest";

import { evaluatePolicy, isGovernanceEnabled, notifyPolicyViolation, resolveCategory } from "@/lib/ai/policy";

const { policyStatus } = vi.hoisted(() => ({
  policyStatus: {
    ALLOWED: "ALLOWED",
    REVIEW: "REVIEW",
    BLOCKED: "BLOCKED",
  } as const,
}));

vi.mock("@prisma/client", () => ({
  PolicyStatus: policyStatus,
}));

vi.mock("@/lib/server-telemetry", () => ({ captureServerEvent: vi.fn() }));

describe("AI policy layer", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves category based on route", () => {
    expect(resolveCategory("/app/dashboard")).toBe("UI");
    expect(resolveCategory("api/internal/users")).toBe("API");
    expect(resolveCategory("/data/export")).toBe("DATA");
  });

  it("marks low confidence UI changes for review", () => {
    const result = evaluatePolicy({ route: "/homepage", confidence: 0.6, action: "modify" });
    expect(result.status).toBe(policyStatus.REVIEW);
    expect(result.reasons[0]).toContain("Confidence");
  });

  it("blocks auto apply when below auto threshold", () => {
    const result = evaluatePolicy({ route: "/landing", confidence: 0.74, action: "auto-apply" });
    expect(result.status).toBe(policyStatus.REVIEW);
    expect(result.allowAutoApply).toBe(false);
  });

  it("blocks critical routes", () => {
    const result = evaluatePolicy({ route: "/admin/settings", confidence: 0.95, action: "modify" });
    expect(result.status).toBe(policyStatus.BLOCKED);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("kritis")]));
  });

  it("emits telemetry when violation occurs", async () => {
    const { captureServerEvent } = await import("@/lib/server-telemetry");
    const evaluation = evaluatePolicy({ route: "/admin/settings", confidence: 0.95, action: "modify" });
    await notifyPolicyViolation({ ...evaluation, route: "/admin/settings" });
    expect(captureServerEvent).toHaveBeenCalledWith("ai_policy_violation", expect.objectContaining({ route: "/admin/settings" }));
  });

  it("is enabled by default", () => {
    expect(isGovernanceEnabled()).toBe(true);
  });
});
