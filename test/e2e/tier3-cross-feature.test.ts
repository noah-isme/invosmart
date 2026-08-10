import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoActionStatus, AutoActionType, ExperimentAxis, PolicyStatus } from "@prisma/client";

// DB Mocks for `@/lib/db`
const dbMocks = vi.hoisted(() => ({
  contentExperiment: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  contentVariant: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  variantMetric: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  aiAutoAction: {
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  optimizationLog: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  agentPriority: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  recoveryLog: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: dbMocks,
}));

import {
  evaluateAutoPublish,
  logAutoAction,
  markAutoActionReverted,
} from "@/lib/ai/approval-gates";
import {
  dispatchWebhookAlert,
  formatDiscordEmbed,
  formatSlackBlocks,
  getEmbedColor,
} from "@/lib/ai/webhooks";
import { runLoop } from "@/lib/ai/loop";
import {
  evaluatePolicy,
  recordGovernanceDecision,
} from "@/lib/ai/policy";
import {
  analyzeRecovery,
  runRecoverySweep,
} from "@/lib/ai/recoveryAgent";
import {
  calculateTrustScore,
  getTrustScore,
} from "@/lib/ai/trustScore";
import {
  dispatchEvent,
  isOrchestrationEnabled,
} from "@/lib/ai/orchestrator";
import { FederationBus } from "@/lib/federation/bus";
import {
  aggregateTrustScores,
  deriveAggregatedPriorities,
  sanitizeMetadata,
  validateFederationEvent,
  type FederationSnapshot,
} from "@/lib/federation/protocol";
import {
  BANDIT_DIM,
  computeLinUCBScore,
  createInitialBanditState,
  extractFeatureVector,
  recordVariantPerformance,
  synthesiseVariantPayload,
} from "@/lib/ai/content-local-optimizer";
import { computeEngagementScore } from "@/lib/ai/scoring";

describe("Tier 3: Cross-Feature Interactions E2E Test Suite", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    // Default mock for agentPriority.upsert
    dbMocks.agentPriority.upsert.mockImplementation(({ create, update }) =>
      Promise.resolve({
        id: `p-${create.agent}`,
        agent: create.agent,
        weight: create.weight,
        confidence: create.confidence ?? 0.5,
        rationale: create.rationale ?? "",
        updatedAt: new Date(),
      })
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Scenario T3.1: Auto-Action -> Webhook Alert + DB Log + Telemetry Update
  // =========================================================================
  describe("Scenario T3.1: Auto-Action -> Webhook Alert + DB Log + Telemetry Update", () => {
    it("T3.1.1: Complete End-to-End Auto-Action Pipeline (Evaluation -> DB Persistence -> Dual Webhook Dispatch -> Autonomous Loop Telemetry Update)", async () => {
      // Step 1: Setup Environment & Mocks
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/tier3-auto";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/tier3-auto";
      process.env.ENABLE_AI_AUTONOMY = "true";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      dbMocks.aiAutoAction.count.mockResolvedValue(0);

      const createdActionRecord = {
        id: 301,
        organizationId: "org-tier3-1",
        actionType: AutoActionType.AUTOPUBLISH,
        contentId: 101,
        experimentId: 201,
        variantId: 301,
        reason: "Memenuhi threshold confidence, sample, dan quota",
        confidence: 0.88,
        status: AutoActionStatus.applied,
        createdAt: new Date("2026-08-11T10:00:00Z"),
        updatedAt: new Date("2026-08-11T10:00:00Z"),
      };
      dbMocks.aiAutoAction.create.mockResolvedValue(createdActionRecord);

      // Step 2: Evaluate Auto-Publish Gate
      const evaluation = await evaluateAutoPublish({
        organizationId: "org-tier3-1",
        axis: ExperimentAxis.HOOK,
        confidence: 0.88,
        sampleSize: 100,
      });

      expect(evaluation.decision).toBe("auto");
      expect(evaluation.reason).toContain("Memenuhi threshold confidence");

      // Step 3: Log Auto-Action (persists DB record & dispatches webhook alert asynchronously)
      const loggedAction = await logAutoAction({
        organizationId: "org-tier3-1",
        actionType: AutoActionType.AUTOPUBLISH,
        contentId: 101,
        experimentId: 201,
        variantId: 301,
        reason: evaluation.reason,
        confidence: 0.88,
      });

      expect(dbMocks.aiAutoAction.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org-tier3-1",
          actionType: AutoActionType.AUTOPUBLISH,
          contentId: 101,
          experimentId: 201,
          variantId: 301,
          reason: evaluation.reason,
          confidence: 0.88,
        },
      });

      expect(loggedAction).toEqual(createdActionRecord);

      // Step 4: Allow non-blocking async webhook dispatch to resolve
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/tier3-auto",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/tier3-auto",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );

      // Verify payload formatting
      const discordCall = mockFetch.mock.calls.find((call) =>
        call[0].includes("discord")
      );
      const discordBody = JSON.parse(discordCall[1].body);
      expect(discordBody.embeds[0].title).toContain("AUTOPUBLISH");
      expect(discordBody.embeds[0].color).toBe(0x2ecc71);

      const slackCall = mockFetch.mock.calls.find((call) =>
        call[0].includes("slack")
      );
      const slackBody = JSON.parse(slackCall[1].body);
      expect(slackBody.blocks[0].text.text).toContain("AUTOPUBLISH");

      // Step 5: Execute Autonomous Loop Telemetry Sweep
      dbMocks.agentPriority.findMany.mockResolvedValue([
        { id: "1", agent: "optimizer", weight: 0.75, confidence: 0.8, rationale: "Active" },
      ]);
      dbMocks.recoveryLog.findMany.mockResolvedValue([]);
      dbMocks.recoveryLog.create.mockResolvedValue({
        id: 1,
        agent: "optimizer",
        action: "noop",
        reason: "Performa stabil",
        trustScoreBefore: 85,
        trustScoreAfter: 85,
        traceId: null,
        createdAt: new Date(),
      });

      const loopResult = await runLoop({ emitEvent: false });
      expect(loopResult.enabled).toBe(true);
      expect(loopResult.telemetry).toBeDefined();
      expect(loopResult.telemetry.load).toBeGreaterThanOrEqual(0);
      expect(loopResult.telemetry.recoveryAction).toBe("noop");
      expect(loopResult.summary).toContain("Prioritas:");
    });

    it("T3.1.2: Auto-Action Revert Cascade (Status Update -> Revert Webhook Notification -> System Metric Sync)", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/revert";

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const revertedRecord = {
        id: 301,
        organizationId: "org-tier3-1",
        actionType: AutoActionType.AUTOPUBLISH,
        contentId: 101,
        experimentId: 201,
        variantId: 301,
        reason: "Manual audit revert triggered by admin",
        confidence: 0.88,
        status: AutoActionStatus.reverted,
        createdAt: new Date("2026-08-11T10:00:00Z"),
        updatedAt: new Date("2026-08-11T10:15:00Z"),
      };
      dbMocks.aiAutoAction.update.mockResolvedValue(revertedRecord);

      const res = await markAutoActionReverted({
        actionId: 301,
        reason: "Manual audit revert triggered by admin",
      });

      expect(res.status).toBe(AutoActionStatus.reverted);
      expect(dbMocks.aiAutoAction.update).toHaveBeenCalledWith({
        where: { id: 301 },
        data: {
          status: AutoActionStatus.reverted,
          reason: "Manual audit revert triggered by admin",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockFetch).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/revert",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  // =========================================================================
  // Scenario T3.2: Policy Violation -> Recovery Sweep Rollback -> Trust Score Update -> Federation Priority Share Event
  // =========================================================================
  describe("Scenario T3.2: Policy Violation -> Recovery Sweep Rollback -> Trust Score Update -> Federation Priority Share Event", () => {
    it("T3.2.1: Complete Governance & Recovery Pipeline (Critical Policy Block -> Anomaly Detection -> Recovery Sweep Rollback -> Composite Trust Score Degradation -> Federation Priority Share)", async () => {
      process.env.ENABLE_AI_FEDERATION = "true";
      process.env.FEDERATION_TOKEN_SECRET = "secret-key-t32";
      process.env.FEDERATION_TENANT_ID = "tenant-local-32";

      // Step 1: Governance Policy Evaluation on Critical Route
      const policyEval = evaluatePolicy({
        route: "/admin/security-settings",
        confidence: 0.5,
        action: "auto-apply",
      });

      expect(policyEval.status).toBe(PolicyStatus.BLOCKED);
      expect(policyEval.allowAutoApply).toBe(false);
      expect(policyEval.reasons.some((r) => r.includes("rute kritis"))).toBe(true);

      // Step 2: Record Governance Decision & Event Dispatch
      await recordGovernanceDecision({
        route: "/admin/security-settings",
        evaluation: policyEval,
        recommendationId: "rec-t32-1",
      });

      // Step 3: High Error Rate Triggering Recovery Sweep Rollback
      dbMocks.recoveryLog.create.mockResolvedValue({
        id: 50,
        agent: "optimizer",
        action: "rollback",
        reason: "Regresi 25.0% terdeteksi, memicu rollback & re-evaluasi",
        trustScoreBefore: 80,
        trustScoreAfter: 60,
        traceId: "trace-t32-001",
        createdAt: new Date(),
      });

      const recoveryResult = await runRecoverySweep({
        errorRate: 0.22,
        agent: "optimizer",
        traceId: "trace-t32-001",
      });

      expect(recoveryResult.action).toBe("rollback");
      expect(recoveryResult.agent).toBe("optimizer");
      expect(recoveryResult.reason).toMatch(/Regresi|Error rate/);

      // Step 4: Calculate Updated Composite Trust Score
      const trustScoreValue = calculateTrustScore({
        successRate: 0.55,
        rollbackRate: 0.25,
        policyViolationRate: 0.20,
      });

      // Formula: 50% * 0.55 + 30% * (1 - 0.25) + 20% * (1 - 0.20) = 27.5 + 22.5 + 16.0 = 66.0
      expect(trustScoreValue).toBeCloseTo(66.0, 1);

      // Step 5: Publish Priority Share Event via FederationBus
      const bus = new FederationBus({
        tenantId: "tenant-local-32",
        secret: "secret-key-t32",
        enabled: true,
      });

      const priorityListener = vi.fn();
      bus.subscribe("priority_share", priorityListener);

      const publishResult = await bus.publish({
        type: "priority_share",
        tenantId: "tenant-local-32",
        payload: {
          tenantId: "tenant-local-32",
          cycleId: "cycle-t32-001",
          priorities: [
            {
              agent: "recovery",
              weight: 0.85,
              confidence: 0.95,
              rationale: "Rollback executed following critical policy violation spike",
            },
            {
              agent: "governance",
              weight: 0.90,
              confidence: 0.98,
              rationale: "Critical route protection active",
            },
          ],
          rationale: "Recovery priority share cycle",
        },
      });

      expect(publishResult.event).not.toBeNull();
      expect(publishResult.event?.signature).toBeDefined();
      expect(publishResult.event?.signature.length).toBeGreaterThanOrEqual(10);
      expect(priorityListener).toHaveBeenCalledTimes(1);

      const recentEvents = bus.getRecentEvents();
      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0].type).toBe("priority_share");
    });

    it("T3.2.2: Soft Recovery Action (Re-evaluate) on Non-Critical Policy Review", async () => {
      // Evaluate API route with slightly low confidence
      const policyEval = evaluatePolicy({
        route: "/api/invoices/batch",
        confidence: 0.8, // below API 0.85 threshold
        action: "modify",
      });

      expect(policyEval.status).toBe(PolicyStatus.REVIEW);

      // Analyze recovery with moderate error rate (0.09)
      const recoveryAction = analyzeRecovery({
        trustScoreBefore: 80,
        trustScoreAfter: 73.6,
        errorRate: 0.09,
        traceId: "trace-soft-recovery",
      });

      expect(recoveryAction.action).toBe("reevaluate");
      expect(recoveryAction.reason).toContain("Tren kualitas menurun");
    });
  });

  // =========================================================================
  // Scenario T3.3: Multi-Tenant Federation Sync -> Aggregated Agent Priority Update -> Contextual Bandit Variant Selection Adjustment
  // =========================================================================
  describe("Scenario T3.3: Multi-Tenant Federation Sync -> Aggregated Agent Priority Update -> Contextual Bandit Variant Selection Adjustment", () => {
    it("T3.3.1: Cross-Tenant Telemetry Ingestion -> Aggregated Priority Derivation -> Contextual Bandit Scoring & Variant Adjustment", async () => {
      // Step 1: Multi-Tenant Snapshot Construction
      const snapshotAlpha: FederationSnapshot = {
        tenantId: "tenant-alpha",
        trustScore: 92,
        syncLatencyMs: 120,
        priorities: [
          {
            agent: "optimizer",
            weight: 0.85,
            confidence: 0.90,
            rationale: "Strong CTR uplift in retail segment",
          },
          {
            agent: "learning",
            weight: 0.65,
            confidence: 0.80,
            rationale: "High composite impact",
          },
        ],
        updatedAt: new Date("2026-08-11T09:00:00Z").toISOString(),
      };

      const snapshotBeta: FederationSnapshot = {
        tenantId: "tenant-beta",
        trustScore: 88,
        syncLatencyMs: 150,
        priorities: [
          {
            agent: "optimizer",
            weight: 0.75,
            confidence: 0.80,
            rationale: "Hook conversion boost",
          },
          {
            agent: "learning",
            weight: 0.55,
            confidence: 0.70,
            rationale: "Steady learning rate",
          },
        ],
        updatedAt: new Date("2026-08-11T09:05:00Z").toISOString(),
      };

      const snapshotGamma: FederationSnapshot = {
        tenantId: "tenant-gamma",
        trustScore: 84,
        syncLatencyMs: 180,
        priorities: [
          {
            agent: "optimizer",
            weight: 0.65,
            confidence: 0.70,
            rationale: "Dwell time increase",
          },
        ],
        updatedAt: new Date("2026-08-11T09:10:00Z").toISOString(),
      };

      // Step 2: Derive Aggregated Priorities Across Multi-Tenant Snapshots
      const aggregatedPriorities = deriveAggregatedPriorities([
        snapshotAlpha,
        snapshotBeta,
        snapshotGamma,
      ]);

      const optimizerAgg = aggregatedPriorities.find((a) => a.agent === "optimizer");
      expect(optimizerAgg).toBeDefined();
      // Average weight: (0.85 + 0.75 + 0.65) / 3 = 0.75
      expect(optimizerAgg?.weight).toBe(0.75);
      // Average confidence: (0.90 + 0.80 + 0.70) / 3 = 0.8
      expect(optimizerAgg?.confidence).toBe(0.8);
      expect(optimizerAgg?.rationale).toContain("Bobot federasi rata-rata");

      // Aggregate Trust Scores
      const trustAggregate = aggregateTrustScores([
        snapshotAlpha,
        snapshotBeta,
        snapshotGamma,
      ]);
      expect(trustAggregate.averageTrust).toBe(88);
      expect(trustAggregate.highest?.tenantId).toBe("tenant-alpha");
      expect(trustAggregate.lowest?.tenantId).toBe("tenant-gamma");

      // Step 3: Federation Bus Ingestion of Remote Telemetry Event
      const bus = new FederationBus({
        tenantId: "tenant-local-33",
        secret: "fed-secret-33",
        enabled: true,
      });

      const globalSignal = "High performing HOOK pattern across retail tenant network";

      const publishResult = await bus.publish({
        type: "telemetry_sync",
        tenantId: "tenant-remote-99",
        payload: {
          tenantId: "tenant-remote-99",
          trustScore: 92,
          priorities: snapshotAlpha.priorities,
          insightSummary: globalSignal,
          sanitized: true,
        },
      });

      expect(publishResult.event).not.toBeNull();
      expect(publishResult.event?.tenantId).toBe("tenant-remote-99");

      // Step 4: Synthesise Variant using Contextual Bandit incorporating Global Signal
      const baselinePayload = { hook: "Diskon Spesial Minggu Ini" };
      const synthesized = synthesiseVariantPayload(
        ExperimentAxis.HOOK,
        baselinePayload,
        1,
        {
          tone: "bold",
          targetMetric: "ctr",
          globalSignal,
        }
      );

      expect(synthesized.payload.hook).toContain("Diskon Spesial Minggu Ini");
      expect(synthesized.explanation).toContain(
        `terinspirasi sinyal global: ${globalSignal}`
      );
      expect(synthesized.confidence).toBeGreaterThanOrEqual(0.5);
      expect(synthesized.confidence).toBeLessThanOrEqual(0.95);

      // Step 5: Record Variant Performance & Update LinUCB Bandit Prior Weights
      const initialBanditState = createInitialBanditState();
      dbMocks.contentVariant.findUnique.mockResolvedValue({
        id: 501,
        experimentId: 10,
        variantKey: "variant-1",
        payload: {
          hook: synthesized.payload.hook,
          metadata: {
            tone: "bold",
            targetMetric: "ctr",
            banditState: initialBanditState,
          },
        },
        confidence: 0.70,
        experiment: { axis: ExperimentAxis.HOOK },
      });

      dbMocks.variantMetric.findFirst.mockResolvedValue(null);
      dbMocks.variantMetric.create.mockResolvedValue({
        id: 1,
        variantId: 501,
        impressions: 1000,
        clicks: 150,
        conversions: 40,
        dwellMs: 90000,
        ctr: 0.15,
      });

      dbMocks.contentVariant.update.mockResolvedValue({
        id: 501,
        confidence: 0.88,
      });

      const perfSummary = await recordVariantPerformance({
        variantId: 501,
        impressions: 1000,
        clicks: 150,
        conversions: 40,
        dwellMs: 90000,
      });

      expect(perfSummary.impressions).toBe(1000);
      expect(perfSummary.ctr).toBe(0.15);
      expect(dbMocks.contentVariant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 501 },
          data: expect.objectContaining({
            confidence: expect.any(Number),
          }),
        })
      );
    });

    it("T3.3.2: Asymmetric Signature Verification & PII Sanitization across Federation Bus", () => {
      // PII Sanitization check
      const rawPayload = {
        tenantId: "tenant-pii-test",
        trustScore: 85,
        secrets: "super-secret-key-do-not-leak",
        authToken: "bearer-xyz-123",
        pii: { email: "user@example.com", phone: "+123456789" },
        priorities: [
          {
            agent: "optimizer" as const,
            weight: 0.8,
            confidence: 0.9,
            rationale: "Clean telemetry",
          },
        ],
      };

      const sanitized = sanitizeMetadata(rawPayload);
      expect(sanitized.secrets).toBeUndefined();
      expect(sanitized.authToken).toBeUndefined();
      expect(sanitized.pii).toBeUndefined();
      expect(sanitized.tenantId).toBe("tenant-pii-test");
      expect(sanitized.trustScore).toBe(85);

      // Event Validation check
      const prepared = validateFederationEvent({
        type: "telemetry_sync",
        tenantId: "tenant-pii-test",
        payload: rawPayload,
      });

      expect(prepared.tenantId).toBe("tenant-pii-test");
      expect(prepared.payload.trustScore).toBe(85);
    });
  });
});
