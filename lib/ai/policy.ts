import { PolicyStatus } from "@prisma/client";

import { dispatchEvent, isOrchestrationEnabled, registerAgent } from "@/lib/ai/orchestrator";
import { captureServerEvent } from "@/lib/server-telemetry";

export type PolicyCategory = "UI" | "API" | "DATA";
export type PolicyAction = "read" | "modify" | "auto-apply";

export type PolicyEvaluation = {
  status: PolicyStatus;
  reasons: string[];
  minimumConfidence: number;
  allowAutoApply: boolean;
  category: PolicyCategory;
};

if (isOrchestrationEnabled()) {
  registerAgent({
    agentId: "governance",
    name: "GovernanceAgent",
    description: "Mengawasi kepatuhan policy AI dan mengelola trust score.",
    capabilities: ["policy-evaluation", "conflict-resolution", "trust-update"],
  });
}

type PolicyRule = {
  minimumConfidence: number;
  allowedActions: PolicyAction[];
  allowAutoApplyAbove?: number;
};

const POLICY_RULES: Record<PolicyCategory, PolicyRule> = {
  UI: { minimumConfidence: 0.7, allowedActions: ["read", "modify", "auto-apply"], allowAutoApplyAbove: 0.75 },
  API: { minimumConfidence: 0.85, allowedActions: ["read", "modify"], allowAutoApplyAbove: 0.9 },
  DATA: { minimumConfidence: 0.9, allowedActions: ["read"], allowAutoApplyAbove: undefined },
};

const CRITICAL_ROUTE_PREFIXES = ["/auth", "/admin", "/app", "/devtools", "/api/internal"];

export const isGovernanceEnabled = () => process.env.ENABLE_AI_GOVERNANCE !== "false";

export const resolveCategory = (route: string): PolicyCategory => {
  const normalized = route.startsWith("/") ? route : `/${route}`;

  if (normalized.startsWith("/api")) {
    return "API";
  }

  if (normalized.startsWith("/data") || normalized.includes("report") || normalized.includes("export")) {
    return "DATA";
  }

  return "UI";
};

const isCriticalRoute = (route: string) => {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return CRITICAL_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

export const evaluatePolicy = ({
  route,
  confidence,
  action,
}: {
  route: string;
  confidence: number;
  action: PolicyAction;
}): PolicyEvaluation => {
  const category = resolveCategory(route);
  const rule = POLICY_RULES[category];
  const reasons: string[] = [];

  if (!rule.allowedActions.includes(action)) {
    reasons.push(`Aksi ${action} tidak diizinkan untuk kategori ${category}`);
  }

  const lowConfidence = confidence < rule.minimumConfidence;
  if (lowConfidence) {
    reasons.push(`Confidence ${Math.round(confidence * 100)}% di bawah ambang ${Math.round(rule.minimumConfidence * 100)}%`);
  }

  const critical = isCriticalRoute(route);
  if (critical) {
    reasons.push("Perubahan pada rute kritis memerlukan peninjauan manual");
  }

  const disallowedAction = !rule.allowedActions.includes(action);

  let status: PolicyStatus = PolicyStatus.ALLOWED;
  let allowAutoApply = rule.allowedActions.includes("auto-apply");

  if (critical || disallowedAction) {
    status = PolicyStatus.BLOCKED;
  } else if (reasons.length > 0) {
    status = PolicyStatus.REVIEW;
  }

  if (allowAutoApply && typeof rule.allowAutoApplyAbove === "number") {
    allowAutoApply = confidence >= rule.allowAutoApplyAbove;
    if (!allowAutoApply) {
      reasons.push(
        `Auto-apply membutuhkan confidence minimal ${Math.round(rule.allowAutoApplyAbove * 100)}% untuk kategori ${category}`,
      );
      if (status === PolicyStatus.ALLOWED) {
        status = PolicyStatus.REVIEW;
      }
    }
  }

  return { status, reasons, minimumConfidence: rule.minimumConfidence, allowAutoApply, category };
};

export const notifyPolicyViolation = async (evaluation: PolicyEvaluation & { route: string }) => {
  if (evaluation.status === PolicyStatus.ALLOWED) {
    return;
  }

  void captureServerEvent("ai_policy_violation", {
    route: evaluation.route,
    status: evaluation.status,
    reasons: evaluation.reasons.join(" | "),
    category: evaluation.category,
  });
};

export const recordGovernanceDecision = async ({
  route,
  evaluation,
  recommendationId,
}: {
  route: string;
  evaluation: PolicyEvaluation;
  recommendationId?: string;
}) => {
  if (!isOrchestrationEnabled()) return;

  let trust;
  try {
    const { getTrustScore } = await import("@/lib/ai/trustScore");
    trust = await getTrustScore();
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("Failed to compute trust score", error);
    }
    trust = {
      score: 0,
      metrics: {
        successRate: 0,
        rollbackRate: 0,
        policyViolationRate: 0,
        totalRecommendations: 0,
        applied: 0,
        violations: 0,
      },
    };
  }

  await dispatchEvent({
    type: "policy_update",
    source: "governance",
    target: "optimizer",
    payload: {
      summary: `Governance ${evaluation.status} untuk ${route}`,
      context: { reasons: evaluation.reasons },
      recommendationId,
      route,
      status: evaluation.status,
      minimumConfidence: evaluation.minimumConfidence,
      allowAutoApply: evaluation.allowAutoApply,
      trustScore: trust.score,
      trustMetrics: {
        successRate: trust.metrics.successRate,
        rollbackRate: trust.metrics.rollbackRate,
        policyViolationRate: trust.metrics.policyViolationRate,
      },
    },
  });
};
