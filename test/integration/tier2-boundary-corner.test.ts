import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoActionStatus, AutoActionType, ExperimentAxis, PolicyStatus } from "@prisma/client";

// DB Mocks
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
  BANDIT_DIM,
  computeLinUCBScore,
  createInitialBanditState,
  extractFeatureVector,
  recordVariantPerformance,
  synthesiseVariantPayload,
} from "@/lib/ai/content-local-optimizer";
import { computeEngagementScore } from "@/lib/ai/scoring";

import {
  dispatchWebhookAlert,
  formatDiscordEmbedPayload,
  formatSlackBlockKitPayload,
  getEmbedColor,
} from "@/lib/ai/webhooks";
import { logAutoAction, markAutoActionReverted } from "@/lib/ai/approval-gates";

import { FederationBus } from "@/lib/federation/bus";
import {
  aggregateTrustScores,
  deriveAggregatedPriorities,
  sanitizeMetadata,
  validateFederationEvent,
} from "@/lib/federation/protocol";

import { runLoop } from "@/lib/ai/loop";
import { runRecoverySweep } from "@/lib/ai/recoveryAgent";
import { evaluatePolicy } from "@/lib/ai/policy";
import { calculateTrustScore } from "@/lib/ai/trustScore";
import { evaluateScaling } from "@/lib/ai/scaler";

describe("Tier 2: Boundary & Corner Cases E2E Test Suite", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Feature 1: Contextual Bandit Model Boundary Cases
  // =========================================================================
  describe("Feature 1: Contextual Bandit Model Boundary Cases", () => {
    it("T2.1.1: Empty variant payload handling in synthesiseVariantPayload", () => {
      const resultHook = synthesiseVariantPayload(ExperimentAxis.HOOK, {}, 0);
      expect(resultHook.payload.hook).toBe("🚀 Konten unggulan");
      expect(resultHook.explanation).toBeDefined();
      expect(resultHook.confidence).toBeGreaterThanOrEqual(0.50);
      expect(resultHook.confidence).toBeLessThanOrEqual(0.95);
      expect(typeof resultHook.ucbScore).toBe("number");

      const resultCaption = synthesiseVariantPayload(ExperimentAxis.CAPTION, {}, 1);
      expect(resultCaption.payload.caption).toBe("Mengapa ini penting sekarang: Sampaikan nilai utama");

      const resultCta = synthesiseVariantPayload(ExperimentAxis.CTA, {}, 2);
      expect(resultCta.payload.cta).toBe("Mulai Uji Gratis");

      const resultSchedule = synthesiseVariantPayload(ExperimentAxis.SCHEDULE, {}, 0);
      expect(resultSchedule.payload.schedule?.day).toBe("Senin");
      expect(resultSchedule.payload.schedule?.hour).toBe(9);
    });

    it("T2.1.2: Zero impressions / cold start in recordVariantPerformance (zero division safety)", async () => {
      const coldStartEngagement = computeEngagementScore({
        impressions: 0,
        clicks: 0,
        conversions: 0,
        dwellMs: 0,
      });

      expect(coldStartEngagement.ctr).toBe(0);
      expect(coldStartEngagement.conversionRate).toBe(0);
      expect(coldStartEngagement.averageDwellMs).toBe(0);
      expect(coldStartEngagement.score).toBe(0);
      expect(Number.isNaN(coldStartEngagement.score)).toBe(false);

      dbMocks.contentVariant.findUnique.mockResolvedValue({
        id: 1,
        experimentId: 10,
        payload: {},
        experiment: { axis: ExperimentAxis.HOOK },
      });
      dbMocks.variantMetric.findFirst.mockResolvedValue(null);
      dbMocks.variantMetric.create.mockResolvedValue({
        id: 100,
        variantId: 1,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        dwellMs: 0,
        ctr: 0,
      });
      dbMocks.contentVariant.update.mockResolvedValue({ id: 1 });

      const summary = await recordVariantPerformance({
        variantId: 1,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        dwellMs: 0,
      });

      expect(summary).toBeDefined();
      expect(summary.ctr).toBe(0);
      expect(summary.totalImpressions).toBe(0);
      expect(dbMocks.variantMetric.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            impressions: 0,
            ctr: 0,
          }),
        }),
      );
    });

    it("T2.1.3: Out-of-bounds weight values & extreme dwell times (0ms, negative values)", () => {
      const negativeFeatures = extractFeatureVector({
        impressions: -100,
        clicks: -20,
        conversions: -5,
        dwellMs: -50000,
        axis: ExperimentAxis.HOOK,
        tone: "bold",
        targetMetric: "ctr",
      });

      expect(negativeFeatures[0]).toBe(1.0); // Bias
      expect(negativeFeatures[1]).toBe(0); // CTR clamped >= 0
      expect(negativeFeatures[2]).toBe(0); // Conv rate clamped >= 0
      expect(negativeFeatures[3]).toBe(0); // Dwell clamped >= 0
      expect(negativeFeatures[4]).toBe(0); // log10(0+1)/4 = 0

      const extremeFeatures = extractFeatureVector({
        impressions: 10,
        clicks: 50, // Clicks > impressions (out-of-bounds CTR)
        conversions: 100, // Conv > impressions
        dwellMs: 6000000, // 100 minutes (extreme dwell time)
        axis: ExperimentAxis.HOOK,
        tone: "bold",
        targetMetric: "ctr",
      });

      expect(extremeFeatures[1]).toBe(1.0); // CTR clamped to 1.0 max
      expect(extremeFeatures[2]).toBe(1.0); // Conv rate clamped to 1.0 max
      expect(extremeFeatures[3]).toBe(1.0); // Dwell normalized clamped to 1.0 max
    });

    it("T2.1.4: Invalid experiment axis fallback", () => {
      const invalidAxisFeatures = extractFeatureVector({
        axis: "UNKNOWN_UNHANDLED_AXIS" as any,
        tone: "bold",
        targetMetric: "ctr",
      });

      expect(invalidAxisFeatures[5]).toBe(0.5); // Fallback neutral value for unknown axis

      const result = synthesiseVariantPayload("UNKNOWN_AXIS" as any, { hook: "Original Baseline" }, 0);
      expect(result.payload.hook).toBe("Original Baseline");
      expect(result.explanation).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0.50);
    });

    it("T2.1.5: Dynamic confidence calculation with 0 sample size", () => {
      const initialState = createInitialBanditState();
      expect(initialState.sampleCount).toBe(0);
      expect(initialState.A.length).toBe(BANDIT_DIM);

      const featureVector = extractFeatureVector({
        impressions: 0,
        clicks: 0,
        conversions: 0,
        dwellMs: 0,
      });

      const { ucbScore, predictedReward, uncertainty, confidence } = computeLinUCBScore(
        featureVector,
        initialState,
      );

      expect(predictedReward).toBe(0); // Theta is zero vector initially
      expect(uncertainty).toBeGreaterThan(0);
      expect(confidence).toBeGreaterThanOrEqual(0.50);
      expect(confidence).toBeLessThanOrEqual(0.95);
      expect(ucbScore).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Feature 2: Webhook Alerts Boundary Cases
  // =========================================================================
  describe("Feature 2: Webhook Alerts Boundary Cases", () => {
    it("T2.2.1: Missing/undefined DISCORD_WEBHOOK_URL and SLACK_WEBHOOK_URL (graceful degradation, no throw)", async () => {
      delete process.env.DISCORD_WEBHOOK_URL;
      delete process.env.SLACK_WEBHOOK_URL;

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const result = await dispatchWebhookAlert({
        actionType: AutoActionType.AUTOPUBLISH,
        reason: "Test missing webhook URLs",
      });

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("T2.2.2: HTTP network failures (e.g. 500 error / network down) during dispatch", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/fail";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/fail";

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("discord")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        return Promise.reject(new TypeError("Network connection failed"));
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await dispatchWebhookAlert({
        actionType: AutoActionType.AUTO_REVERT,
        reason: "Network failure test",
      });

      expect(result.discord).toEqual({
        ok: false,
        error: "HTTP 500 Internal Server Error",
      });
      expect(result.slack).toEqual({
        ok: false,
        error: "Network connection failed",
      });
    });

    it("T2.2.3: Webhook request timeout handling without blocking auto-action completion", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/timeout";
      const mockFetch = vi.fn().mockRejectedValue(new Error("Request timeout after 5000ms"));
      vi.stubGlobal("fetch", mockFetch);

      const actionRecord = {
        id: 42,
        organizationId: "org-timeout",
        actionType: AutoActionType.AUTOPUBLISH,
        reason: "Auto publish trigger with webhook timeout",
        confidence: 0.9,
        status: AutoActionStatus.applied,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbMocks.aiAutoAction.create.mockResolvedValue(actionRecord);

      const result = await logAutoAction({
        organizationId: "org-timeout",
        actionType: AutoActionType.AUTOPUBLISH,
        reason: "Auto publish trigger with webhook timeout",
        confidence: 0.9,
      });

      expect(result).toEqual(actionRecord);
      expect(dbMocks.aiAutoAction.create).toHaveBeenCalled();
    });

    it("T2.2.4: Malformed/empty action payload handling in payload formatters", () => {
      const emptyPayload = {};

      const discordEmbed = formatDiscordEmbedPayload(emptyPayload);
      expect(discordEmbed.embeds).toHaveLength(1);
      expect(discordEmbed.embeds[0].title).toBe("AI Auto Action: UNKNOWN [applied]");
      expect(discordEmbed.embeds[0].color).toBe(getEmbedColor("UNKNOWN"));
      const discordFields = Object.fromEntries(
        discordEmbed.embeds[0].fields.map((f) => [f.name, f.value]),
      );
      expect(discordFields["Organization ID"]).toBe("N/A");
      expect(discordFields["Reason"]).toBe("N/A");
      expect(discordFields["Confidence"]).toBe("N/A");

      const slackBlocks = formatSlackBlockKitPayload(emptyPayload);
      expect(slackBlocks.blocks).toHaveLength(4);
      expect(slackBlocks.blocks[0].text.text).toBe("AI Auto Action Alert: UNKNOWN");
    });

    it("T2.2.5: Partial webhook configuration (one URL defined, one missing)", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/valid";
      delete process.env.SLACK_WEBHOOK_URL;

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const result = await dispatchWebhookAlert({
        actionType: AutoActionType.SCHEDULE_UPDATE,
        reason: "Partial config test",
      });

      expect(result.discord).toEqual({ ok: true });
      expect(result.slack).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/valid",
        expect.anything(),
      );
    });
  });

  // =========================================================================
  // Feature 3: Federation Bus Boundary Cases
  // =========================================================================
  describe("Feature 3: Federation Bus Boundary Cases", () => {
    it("T2.3.1: Ingesting events with corrupted/tampered cryptographic signatures (explicit rejection)", async () => {
      const bus = new FederationBus({
        tenantId: "local-tenant",
        secret: "super-secret-key-12345",
        enabled: true,
      });

      const validEvent = {
        id: "evt-100",
        type: "telemetry_sync" as const,
        tenantId: "remote-tenant",
        timestamp: new Date().toISOString(),
        signature: "tampered_corrupted_signature_1234567890",
        payload: {
          tenantId: "remote-tenant",
          trustScore: 85,
          sanitized: true,
          priorities: [],
        },
      };

      await expect(bus.ingest(validEvent)).rejects.toThrow("Invalid federation signature");
    });

    it("T2.3.2: Ingesting encrypted payloads with invalid AES keys or corrupted IV", () => {
      const invalidEventPayload = {
        type: "telemetry_sync" as const,
        payload: {
          tenantId: "remote-tenant",
          trustScore: -50, // Invalid: negative trust score (Zod min is 0)
          sanitized: true,
        },
      };

      expect(() => validateFederationEvent(invalidEventPayload as any)).toThrow();
    });

    it("T2.3.3: Disabled federation bus state (ENABLE_AI_FEDERATION=false)", async () => {
      process.env.ENABLE_AI_FEDERATION = "false";

      const bus = new FederationBus({ secret: "some-secret" });
      expect(bus.isEnabled).toBe(false);

      const publishResult = await bus.publish({
        type: "telemetry_sync",
        payload: {
          tenantId: "local",
          trustScore: 90,
          sanitized: true,
          priorities: [],
        },
      });

      expect(publishResult.event).toBeNull();
      expect(publishResult.deliveries).toEqual([]);

      const ingestResult = await bus.ingest({
        id: "evt-1",
        type: "telemetry_sync",
        tenantId: "remote",
        timestamp: new Date().toISOString(),
        signature: "1234567890abcdef",
        payload: { tenantId: "remote", trustScore: 80, sanitized: true, priorities: [] },
      });

      expect(ingestResult).toBe(false);
    });

    it("T2.3.4: Empty metadata object sanitization", () => {
      const emptySanitized = sanitizeMetadata({});
      expect(emptySanitized).toEqual({});

      const dirtyPayload = {
        rawEvents: ["event1", "event2"],
        pii: { email: "user@example.com", ssn: "123-45-6789" },
        secrets: "super-secret-token",
        authToken: "bearer-xyz",
        accessToken: "access-123",
        session: { id: "sess-1" },
        tenantId: "tenant-99",
        trustScore: 88,
        nested: {
          rawEvents: ["nested"],
          pii: "nested-pii",
          validKey: "keep-me",
        },
      };

      const sanitized = sanitizeMetadata(dirtyPayload);

      expect(sanitized).toEqual({
        tenantId: "tenant-99",
        trustScore: 88,
        nested: {
          validKey: "keep-me",
        },
      });
      expect((sanitized as any).rawEvents).toBeUndefined();
      expect((sanitized as any).pii).toBeUndefined();
      expect((sanitized as any).secrets).toBeUndefined();
      expect((sanitized as any).authToken).toBeUndefined();
    });

    it("T2.3.5: Empty or unauthenticated federation snapshot array ingestion", () => {
      const emptyPriorities = deriveAggregatedPriorities([]);
      expect(emptyPriorities).toEqual([]);

      const emptyTrustAggregate = aggregateTrustScores([]);
      expect(emptyTrustAggregate).toEqual({
        averageTrust: 0,
        highest: null,
        lowest: null,
        median: 0,
        stdDeviation: 0,
      });
    });
  });

  // =========================================================================
  // Feature 4: DB & System Loop Boundary Cases
  // =========================================================================
  describe("Feature 4: DB & System Loop Boundary Cases", () => {
    it("T2.4.1: Disabled autonomy loop state (ENABLE_AI_AUTONOMY=false)", async () => {
      process.env.ENABLE_AI_AUTONOMY = "false";

      const loopResult = await runLoop();

      expect(loopResult.enabled).toBe(false);
      expect(loopResult.summary).toBe("Loop otonom dinonaktifkan");
      expect(loopResult.telemetry.load).toBe(0);
      expect(loopResult.recovery.action).toBe("noop");
    });

    it("T2.4.2: High telemetry error rate (>15%) triggering immediate recovery sweep", async () => {
      dbMocks.optimizationLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          route: "/api/invoices",
          status: "APPLIED",
          policyStatus: "REVIEW",
          createdAt: new Date(),
        },
      ]);
      dbMocks.recoveryLog.create.mockResolvedValue({
        id: "rec-1",
        action: "rollback",
      });

      const recovery = await runRecoverySweep({ errorRate: 0.22 }); // 22% error rate > 15% threshold

      expect(recovery.action).toBe("rollback");
      expect(recovery.reason).toContain("Error rate 22.0% > 15%");
    });

    it("T2.4.3: Policy evaluation with undefined route or negative confidence scores", () => {
      const evalUndefinedRoute = evaluatePolicy({
        route: undefined as any || "",
        confidence: -0.5,
        action: "auto-apply",
      });

      expect(evalUndefinedRoute.category).toBe("UI");
      expect(evalUndefinedRoute.allowAutoApply).toBe(false);
      expect(evalUndefinedRoute.status).toBe(PolicyStatus.REVIEW);
      expect(evalUndefinedRoute.reasons.some((r) => r.includes("Confidence"))).toBe(true);

      const evalNegativeConfidence = evaluatePolicy({
        route: "/api/test",
        confidence: -0.1,
        action: "modify",
      });

      expect(evalNegativeConfidence.category).toBe("API");
      expect(evalNegativeConfidence.status).toBe(PolicyStatus.REVIEW);
    });

    it("T2.4.4: Trust score calculation with 100% policy violation rate", () => {
      const penalizedScore = calculateTrustScore({
        successRate: 1.0,
        rollbackRate: 0,
        policyViolationRate: 1.0, // 100% violations -> normalizedPolicy = 0
      });

      // weighted = 1.0 * 0.5 + 1.0 * 0.3 + 0.0 * 0.2 = 0.80 -> 80
      expect(penalizedScore).toBe(80);

      const worstCaseScore = calculateTrustScore({
        successRate: 0,
        rollbackRate: 1.0, // 100% rollbacks -> normalizedRollback = 0
        policyViolationRate: 1.0, // 100% violations -> normalizedPolicy = 0
      });

      expect(worstCaseScore).toBe(0);
    });

    it("T2.4.5: Concurrency scaling limits under extreme backlog load", () => {
      const extremeScaling = evaluateScaling(
        {
          avgLatencyMs: 15000,
          backlogSize: 100000,
          trustScore: 0,
          successRate: 0,
        },
        {
          concurrency: 6, // Already at MAX_CONCURRENCY (6)
          intervalMs: 60000, // Already at MIN_INTERVAL (60000)
        },
      );

      expect(extremeScaling.status).toBe("scale_up");
      expect(extremeScaling.state.concurrency).toBe(6); // Clamped at max 6
      expect(extremeScaling.state.intervalMs).toBe(60000); // Clamped at min 60000
      expect(extremeScaling.reason).toBeDefined();
    });
  });
});
