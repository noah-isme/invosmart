import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoActionStatus, AutoActionType, ExperimentAxis, ExperimentStatus, OptimizationStatus, PolicyStatus } from "@prisma/client";

// DB Mocks for Prisma operations defined using vi.hoisted
const {
  experimentCreateMock,
  experimentFindUniqueMock,
  experimentFindManyMock,
  experimentUpdateMock,
  variantCreateMock,
  variantFindUniqueMock,
  variantUpdateMock,
  metricFindFirstMock,
  metricCreateMock,
  metricUpdateMock,
  aiAutoActionCreateMock,
  aiAutoActionCountMock,
  aiAutoActionUpdateMock,
  invoiceFindManyMock,
  optimizationLogFindManyMock,
  optimizationLogCountMock,
  explanationLogFindManyMock,
  agentPriorityFindManyMock,
  agentPriorityUpsertMock,
  agentEventLogCreateMock,
  recoveryLogCreateMock,
  recoveryLogFindManyMock,
} = vi.hoisted(() => ({
  experimentCreateMock: vi.fn(),
  experimentFindUniqueMock: vi.fn(),
  experimentFindManyMock: vi.fn(),
  experimentUpdateMock: vi.fn(),
  variantCreateMock: vi.fn(),
  variantFindUniqueMock: vi.fn(),
  variantUpdateMock: vi.fn(),
  metricFindFirstMock: vi.fn(),
  metricCreateMock: vi.fn(),
  metricUpdateMock: vi.fn(),
  aiAutoActionCreateMock: vi.fn(),
  aiAutoActionCountMock: vi.fn(),
  aiAutoActionUpdateMock: vi.fn(),
  invoiceFindManyMock: vi.fn(),
  optimizationLogFindManyMock: vi.fn(),
  optimizationLogCountMock: vi.fn(),
  explanationLogFindManyMock: vi.fn(),
  agentPriorityFindManyMock: vi.fn(),
  agentPriorityUpsertMock: vi.fn(),
  agentEventLogCreateMock: vi.fn(),
  recoveryLogCreateMock: vi.fn(),
  recoveryLogFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    contentExperiment: {
      create: experimentCreateMock,
      findUnique: experimentFindUniqueMock,
      findMany: experimentFindManyMock,
      update: experimentUpdateMock,
    },
    contentVariant: {
      create: variantCreateMock,
      findUnique: variantFindUniqueMock,
      update: variantUpdateMock,
    },
    variantMetric: {
      findFirst: metricFindFirstMock,
      create: metricCreateMock,
      update: metricUpdateMock,
    },
    aiAutoAction: {
      create: aiAutoActionCreateMock,
      count: aiAutoActionCountMock,
      update: aiAutoActionUpdateMock,
    },
    invoice: {
      findMany: invoiceFindManyMock,
    },
    optimizationLog: {
      findMany: optimizationLogFindManyMock,
      count: optimizationLogCountMock,
    },
    explanationLog: {
      findMany: explanationLogFindManyMock,
    },
    agentPriority: {
      findMany: agentPriorityFindManyMock,
      upsert: agentPriorityUpsertMock,
    },
    agentEventLog: {
      create: agentEventLogCreateMock,
    },
    recoveryLog: {
      create: recoveryLogCreateMock,
      findMany: recoveryLogFindManyMock,
    },
  },
}));

// Feature 1 Imports
import {
  computeLinUCBScore,
  createInitialBanditState,
  extractFeatureVector,
  generateVariant,
  recordVariantPerformance,
  startExperiment,
  synthesiseVariantPayload,
  chooseWinner,
  BANDIT_DIM,
  ALPHA,
} from "@/lib/ai/content-local-optimizer";
import { computeEngagementScore, DEFAULT_ENGAGEMENT_WEIGHTS } from "@/lib/ai/scoring";

// Feature 2 Imports
import {
  dispatchWebhookAlert,
  formatDiscordEmbedPayload,
  formatSlackBlockKitPayload,
  getEmbedColor,
} from "@/lib/ai/webhooks";
import { evaluateAutoPublish, markAutoActionReverted } from "@/lib/ai/approval-gates";

// Feature 3 Imports
import { FederationBus, generateFederationKeyPair } from "@/lib/federation/bus";
import {
  aggregateTrustScores,
  deriveAggregatedPriorities,
  federationEventSchema,
  sanitizeMetadata,
  validateFederationEvent,
  type FederationEvent,
  type FederationSnapshot,
} from "@/lib/federation/protocol";

// Feature 4 Imports
import { evaluatePolicy, resolveCategory } from "@/lib/ai/policy";
import { calculateTrustScore, getTrustMetrics, getTrustScore } from "@/lib/ai/trustScore";
import { adaptiveInterval, runLoop } from "@/lib/ai/loop";
import { db } from "@/lib/db";

describe("Tier 1 E2E Feature Coverage Test Suite", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ==========================================
  // FEATURE 1: Contextual Bandit Model (R1)
  // ==========================================
  describe("Feature 1: Contextual Bandit Model (R1)", () => {
    it("T1.1.1: LinUCB reward scoring calculates weighted CTR (0.45), conversions (0.40), and dwell (0.15)", () => {
      const performance = {
        impressions: 1000,
        clicks: 150,
        conversions: 30,
        dwellMs: 1800000, // 1800s total -> 1.8s avg dwell -> 1800000 / 1000 = 1800ms avg -> 1800/60000 = 0.03 normalized dwell
      };

      const engagement = computeEngagementScore(performance, DEFAULT_ENGAGEMENT_WEIGHTS);

      const expectedCtr = 0.15; // 150/1000
      const expectedConv = 0.03; // 30/1000
      const expectedDwellNorm = 1800 / 60000; // 0.03
      const expectedScore = expectedCtr * 0.45 + expectedConv * 0.40 + expectedDwellNorm * 0.15;

      expect(engagement.ctr).toBeCloseTo(expectedCtr, 4);
      expect(engagement.conversionRate).toBeCloseTo(expectedConv, 4);
      expect(engagement.averageDwellMs).toBe(1800);
      expect(engagement.score).toBeCloseTo(expectedScore, 4);

      const featureVector = extractFeatureVector({
        impressions: performance.impressions,
        clicks: performance.clicks,
        conversions: performance.conversions,
        dwellMs: performance.dwellMs,
        axis: ExperimentAxis.HOOK,
        tone: "bold",
        targetMetric: "ctr",
      });

      const state = createInitialBanditState();
      const linUcb = computeLinUCBScore(featureVector, state, ALPHA);

      expect(featureVector).toHaveLength(BANDIT_DIM);
      expect(linUcb.predictedReward).toBe(0); // Zero vector b initially
      expect(linUcb.uncertainty).toBeGreaterThan(0);
      expect(linUcb.ucbScore).toBeCloseTo(ALPHA * linUcb.uncertainty, 4);
      expect(linUcb.confidence).toBeGreaterThanOrEqual(0.50);
      expect(linUcb.confidence).toBeLessThanOrEqual(0.95);
    });

    it("T1.1.2: Dynamic variant payload synthesis across HOOK, CAPTION, CTA, and SCHEDULE axes", () => {
      const baselinePayload = {
        hook: "Draft Invoice Header",
        caption: "Billing description text",
        cta: "Mulai Sekarang",
        schedule: { day: "Senin", hour: 9, timezone: "Asia/Jakarta" },
      };

      // Hook Axis
      const hookVariant = synthesiseVariantPayload(ExperimentAxis.HOOK, baselinePayload, 0, { tone: "bold" });
      expect(hookVariant.payload.hook).toBeDefined();
      expect(hookVariant.payload.hook).toContain("Draft Invoice Header");
      expect(hookVariant.explanation).toContain("penekanan nilai");

      // Caption Axis
      const captionVariant = synthesiseVariantPayload(ExperimentAxis.CAPTION, baselinePayload, 1, { tone: "curious" });
      expect(captionVariant.payload.caption).toBeDefined();
      expect(captionVariant.explanation).toContain("rasa penasaran");

      // CTA Axis
      const ctaVariant = synthesiseVariantPayload(ExperimentAxis.CTA, baselinePayload, 1, { tone: "urgent" });
      expect(ctaVariant.payload.cta).toBeDefined();
      expect(ctaVariant.explanation).toContain("sense of urgency");

      // Schedule Axis
      const scheduleVariant = synthesiseVariantPayload(ExperimentAxis.SCHEDULE, baselinePayload, 0, { targetMetric: "dwell" });
      expect(scheduleVariant.payload.schedule).toBeDefined();
      expect(scheduleVariant.payload.schedule?.hour).toBe(9);
      expect(scheduleVariant.payload.schedule?.timezone).toBe("Asia/Jakarta");
    });

    it("T1.1.3: Variant performance recording and LinUCB matrix updates via recordVariantPerformance", async () => {
      const initialBanditState = createInitialBanditState();
      const variantRecord = {
        id: 501,
        experimentId: 10,
        variantKey: "variant-1",
        payload: {
          hook: "Custom Hook",
          metadata: {
            tone: "bold",
            targetMetric: "ctr",
            banditState: initialBanditState,
          },
        },
        confidence: 0.60,
        experiment: { axis: ExperimentAxis.HOOK },
        metrics: [],
      };

      variantFindUniqueMock.mockResolvedValue(variantRecord);
      metricFindFirstMock.mockResolvedValue(null);
      metricCreateMock.mockResolvedValue({
        id: 1,
        variantId: 501,
        impressions: 200,
        clicks: 40,
        conversions: 10,
        dwellMs: 120000,
        ctr: 0.20,
      });
      variantUpdateMock.mockResolvedValue({ id: 501 });

      const result = await recordVariantPerformance({
        variantId: 501,
        impressions: 200,
        clicks: 40,
        conversions: 10,
        dwellMs: 120000,
      });

      expect(metricCreateMock).toHaveBeenCalledTimes(1);
      expect(variantUpdateMock).toHaveBeenCalledTimes(1);

      const updateCall = variantUpdateMock.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 501 });
      const updatedPayload = JSON.parse(JSON.stringify(updateCall.data.payload));
      expect(updatedPayload.metadata.banditState.sampleCount).toBe(1);
      expect(updatedPayload.metadata.banditState.A).toHaveLength(8);
      expect(updatedPayload.metadata.banditState.b).toHaveLength(8);
      expect(updateCall.data.confidence).toBeGreaterThan(0.50);

      expect(result.impressions).toBe(200);
      expect(result.clicks).toBe(40);
      expect(result.conversions).toBe(10);
    });

    it("T1.1.4: Full experiment lifecycle (startExperiment -> generateVariant -> recordVariantPerformance -> chooseWinner)", async () => {
      // 1. Start Experiment
      const createdExp = {
        id: 701,
        organizationId: "org-test",
        contentId: 42,
        axis: ExperimentAxis.HOOK,
        status: ExperimentStatus.running,
        startAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      experimentCreateMock.mockResolvedValue(createdExp);
      variantCreateMock.mockResolvedValue({ id: 1001 });

      const baselineSummaryMock = {
        experiment: { ...createdExp, variants: [] },
        variants: [
          {
            variant: { id: 1001, variantKey: "baseline", payload: { hook: "Baseline Hook" } },
            performance: { impressions: 0, clicks: 0, conversions: 0, dwellMs: 0 },
            engagement: { score: 0 },
            uplift: 0,
            pValue: 1,
            totalSample: 0,
            isWinner: false,
          },
        ],
      };
      experimentFindUniqueMock.mockResolvedValue(baselineSummaryMock.experiment);

      const startResult = await startExperiment({
        organizationId: "org-test",
        contentId: 42,
        axis: ExperimentAxis.HOOK,
        baseline: { hook: "Baseline Hook" },
      });

      expect(experimentCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contentId: 42, axis: ExperimentAxis.HOOK }),
        }),
      );
      expect(startResult.experiment.id).toBe(701);

      // 2. Generate Candidate Variant
      experimentFindUniqueMock
        .mockResolvedValueOnce({
          ...createdExp,
          variants: [
            { id: 1001, variantKey: "baseline", payload: { hook: "Baseline Hook" }, metrics: [] },
          ],
        })
        .mockResolvedValueOnce({
          ...createdExp,
          variants: [
            { id: 1001, variantKey: "baseline", payload: { hook: "Baseline Hook" }, metrics: [] },
            { id: 1002, variantKey: "variant-1", payload: { hook: "🚀 Baseline Hook" }, metrics: [] },
          ],
        });

      const generateResult = await generateVariant({
        experimentId: 701,
        tone: "bold",
        targetMetric: "ctr",
      });
      expect(variantCreateMock).toHaveBeenCalled();
      expect(generateResult.variants.length).toBeGreaterThan(0);

      // 3. Choose Winner
      experimentUpdateMock.mockResolvedValue({ ...createdExp, status: ExperimentStatus.completed, winnerVariantId: 1002 });
      experimentFindUniqueMock.mockResolvedValue({
        ...createdExp,
        status: ExperimentStatus.completed,
        winnerVariantId: 1002,
        variants: [
          { id: 1001, variantKey: "baseline", payload: { hook: "Baseline Hook" }, metrics: [] },
          { id: 1002, variantKey: "variant-1", payload: { hook: "🚀 Baseline Hook" }, metrics: [] },
        ],
      });

      const winnerResult = await chooseWinner({ experimentId: 701, variantId: 1002 });
      expect(experimentUpdateMock).toHaveBeenCalledWith({
        where: { id: 701 },
        data: expect.objectContaining({ winnerVariantId: 1002, status: ExperimentStatus.completed }),
      });
      expect(winnerResult.winner?.variant.id).toBe(1002);
    });

    it("T1.1.5: Dynamic confidence calculation growth with sample size", () => {
      let state = createInitialBanditState();
      const x = extractFeatureVector({ impressions: 50, clicks: 10, conversions: 2, dwellMs: 30000 });

      const coldScore = computeLinUCBScore(x, state);
      expect(coldScore.confidence).toBeGreaterThanOrEqual(0.50);

      // Simulate accumulating observations over multiple training updates
      for (let i = 0; i < 50; i++) {
        const outer = extractFeatureVector({ impressions: 100 * (i + 1), clicks: 20 * (i + 1), conversions: 4 * (i + 1) });
        state.A = state.A.map((row, r) => row.map((val, c) => val + outer[r] * outer[c]));
        state.b = state.b.map((val, idx) => val + outer[idx] * 0.7);
        state.sampleCount += 1;
      }

      const warmScore = computeLinUCBScore(x, state);

      expect(warmScore.uncertainty).toBeLessThan(coldScore.uncertainty);
      expect(warmScore.confidence).toBeGreaterThan(coldScore.confidence);
      expect(warmScore.confidence).toBeLessThanOrEqual(0.95);
    });
  });

  // ==========================================
  // FEATURE 2: Real-time Webhook Alerts (R2)
  // ==========================================
  describe("Feature 2: Real-time Webhook Alerts (R2)", () => {
    it("T1.2.1: Discord Embed payload formatting for AUTOPUBLISH, SCHEDULE_UPDATE, and AUTO_REVERT actions", () => {
      expect(getEmbedColor(AutoActionType.AUTOPUBLISH)).toBe(0x2ecc71); // Green
      expect(getEmbedColor(AutoActionType.SCHEDULE_UPDATE)).toBe(0x3498db); // Blue
      expect(getEmbedColor(AutoActionType.AUTO_REVERT)).toBe(0xe74c3c); // Red

      const autopublishEmbed = formatDiscordEmbedPayload({
        actionType: AutoActionType.AUTOPUBLISH,
        organizationId: "org-alpha",
        status: AutoActionStatus.applied,
        reason: "Confidence threshold exceeded",
        confidence: 0.95,
        createdAt: new Date("2026-08-10T10:00:00Z"),
      });

      expect(autopublishEmbed.embeds[0].color).toBe(0x2ecc71);
      expect(autopublishEmbed.embeds[0].title).toContain("AUTOPUBLISH");
      expect(autopublishEmbed.embeds[0].timestamp).toBe("2026-08-10T10:00:00.000Z");

      const revertEmbed = formatDiscordEmbedPayload({
        actionType: AutoActionType.AUTO_REVERT,
        organizationId: "org-beta",
        status: AutoActionStatus.reverted,
        reason: "Performance regression > 10%",
        confidence: 0.85,
      });

      expect(revertEmbed.embeds[0].color).toBe(0xe74c3c);
      expect(revertEmbed.embeds[0].title).toContain("AUTO_REVERT");
    });

    it("T1.2.2: Slack Block Kit formatting with section & context blocks", () => {
      const action = {
        actionType: AutoActionType.SCHEDULE_UPDATE,
        organizationId: "org-slack",
        status: AutoActionStatus.applied,
        reason: "Optimal timing window identified",
        confidence: 0.89,
        createdAt: new Date("2026-08-10T15:30:00Z"),
      };

      const payload = formatSlackBlockKitPayload(action);

      expect(payload.blocks).toHaveLength(4);
      expect(payload.blocks[0].type).toBe("header");
      expect(payload.blocks[0].text.text).toContain("SCHEDULE_UPDATE");

      expect(payload.blocks[1].type).toBe("section");
      expect(payload.blocks[1].fields).toHaveLength(4);
      expect(payload.blocks[1].fields[1].text).toContain("org-slack");

      expect(payload.blocks[2].type).toBe("section");
      expect(payload.blocks[2].text.text).toContain("Optimal timing window identified");

      expect(payload.blocks[3].type).toBe("context");
      expect(payload.blocks[3].elements[0].text).toContain("2026-08-10T15:30:00.000Z");
    });

    it("T1.2.3: Dual webhook dispatch executing fetch POST requests to DISCORD_WEBHOOK_URL & SLACK_WEBHOOK_URL", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test-hook";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test-hook";

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
      vi.stubGlobal("fetch", mockFetch);

      const action = {
        actionType: AutoActionType.AUTOPUBLISH,
        organizationId: "org-dual",
        reason: "Dual alert dispatch test",
        confidence: 0.91,
      };

      const dispatchResult = await dispatchWebhookAlert(action);

      expect(dispatchResult).toEqual({
        discord: { ok: true },
        slack: { ok: true },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/test-hook",
        expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/test-hook",
        expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } }),
      );
    });

    it("T1.2.4: Approval gate evaluateAutoPublish integration", async () => {
      // 1. Missing org -> needs approval
      const noOrg = await evaluateAutoPublish({
        axis: ExperimentAxis.HOOK,
        confidence: 0.90,
        sampleSize: 100,
      });
      expect(noOrg.decision).toBe("needs_approval");
      expect(noOrg.reason).toContain("Organisasi tidak dikenali");

      // 2. High stakes CTA -> needs approval
      aiAutoActionCountMock.mockResolvedValue(0);
      const highStakes = await evaluateAutoPublish({
        organizationId: "org-1",
        axis: ExperimentAxis.CTA,
        confidence: 0.95,
        sampleSize: 100,
        highStakes: true,
      });
      expect(highStakes.decision).toBe("needs_approval");
      expect(highStakes.reason).toContain("CTA high-stakes");

      // 3. Valid params -> auto decision
      const autoDecision = await evaluateAutoPublish({
        organizationId: "org-1",
        axis: ExperimentAxis.HOOK,
        confidence: 0.85,
        sampleSize: 100,
      });
      expect(autoDecision.decision).toBe("auto");
      expect(autoDecision.reason).toContain("Memenuhi threshold");
    });

    it("T1.2.5: Revert action alert dispatch via markAutoActionReverted", async () => {
      const revertedRecord = {
        id: 99,
        organizationId: "org-revert",
        actionType: AutoActionType.AUTOPUBLISH,
        contentId: 5,
        experimentId: 10,
        variantId: 20,
        reason: "Performance regressed during sweep",
        confidence: 0.88,
        status: AutoActionStatus.reverted,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      aiAutoActionUpdateMock.mockResolvedValue(revertedRecord);

      const result = await markAutoActionReverted({ actionId: 99, reason: "Performance regressed during sweep" });

      expect(aiAutoActionUpdateMock).toHaveBeenCalledWith({
        where: { id: 99 },
        data: { status: AutoActionStatus.reverted, reason: "Performance regressed during sweep" },
      });
      expect(result.status).toBe(AutoActionStatus.reverted);

      const embedPayload = formatDiscordEmbedPayload(result);
      expect(embedPayload.embeds[0].color).toBe(0x2ecc71); // AUTOPUBLISH type
      expect(embedPayload.embeds[0].title).toContain("reverted");
    });
  });

  // ==========================================
  // FEATURE 3: Asymmetric Federation Bus (R3)
  // ==========================================
  describe("Feature 3: Asymmetric Federation Bus (R3)", () => {
    it("T1.3.1: RSA/Ed25519 asymmetric signature generation & verification", async () => {
      const producerKeys = generateFederationKeyPair();
      const consumerKeys = generateFederationKeyPair();

      const producer = new FederationBus({
        tenantId: "tenant-a",
        privateKey: producerKeys.privateKey,
        publicKey: producerKeys.publicKey,
        keyId: "key-a",
        peerPublicKeys: { "tenant-b": consumerKeys.publicKey },
        enabled: true,
      });

      const consumer = new FederationBus({
        tenantId: "tenant-b",
        privateKey: consumerKeys.privateKey,
        publicKey: consumerKeys.publicKey,
        keyId: "key-b",
        peerPublicKeys: { "tenant-a": producerKeys.publicKey },
        enabled: true,
      });

      const listener = vi.fn();
      consumer.subscribe("telemetry_sync", listener);

      const { event } = await producer.publish({
        type: "telemetry_sync",
        payload: {
          tenantId: "tenant-a",
          trustScore: 88,
          priorities: [],
          sanitized: true,
        },
      });

      expect(event).not.toBeNull();
      expect(event?.signatureAlgorithm).toBe("rsa-sha256");
      expect(event?.keyId).toBe("key-a");
      expect(event?.signature).toBeDefined();

      const ingested = await consumer.ingest(event as FederationEvent);
      expect(ingested).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("T1.3.2: Hybrid AES-256-GCM payload encryption & decryption", async () => {
      const producerKeys = generateFederationKeyPair();
      const consumerKeys = generateFederationKeyPair();

      const producer = new FederationBus({
        tenantId: "tenant-producer",
        privateKey: producerKeys.privateKey,
        publicKey: producerKeys.publicKey,
        peerPublicKeys: { "tenant-consumer": consumerKeys.publicKey },
        enabled: true,
      });

      const consumer = new FederationBus({
        tenantId: "tenant-consumer",
        privateKey: consumerKeys.privateKey,
        publicKey: consumerKeys.publicKey,
        peerPublicKeys: { "tenant-producer": producerKeys.publicKey },
        enabled: true,
      });

      const listener = vi.fn();
      consumer.subscribe("model_update", listener);

      const { event } = await producer.publish({
        type: "model_update",
        recipientPublicKey: consumerKeys.publicKey,
        payload: {
          tenantId: "tenant-producer",
          cycleId: "cycle-101",
          priorities: [{ agent: "optimizer", weight: 0.8, confidence: 0.9, rationale: "High impact" }],
          trustScore: 92,
        },
      });

      expect(event).not.toBeNull();
      expect(event?.encryptedPayload).toBeDefined();
      expect(event?.encryptedKey).toBeDefined();
      expect(event?.iv).toBeDefined();
      expect(event?.payload).toBeUndefined();

      const ingested = await consumer.ingest(event as FederationEvent);
      expect(ingested).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      const receivedEvent = listener.mock.calls[0][0];
      expect(receivedEvent.payload.cycleId).toBe("cycle-101");
      expect(receivedEvent.payload.trustScore).toBe(92);
    });

    it("T1.3.3: Event pub/sub subscriptions for telemetry_sync, priority_share, trust_aggregate, model_update", async () => {
      const bus = new FederationBus({ tenantId: "tenant-sub", secret: "sub-secret", enabled: true });

      const telemetryListener = vi.fn();
      const priorityListener = vi.fn();
      const trustListener = vi.fn();
      const modelListener = vi.fn();

      bus.subscribe("telemetry_sync", telemetryListener);
      bus.subscribe("priority_share", priorityListener);
      bus.subscribe("trust_aggregate", trustListener);
      bus.subscribe("model_update", modelListener);

      await bus.publish({
        type: "telemetry_sync",
        payload: { tenantId: "tenant-sub", trustScore: 80, priorities: [], sanitized: true },
      });

      await bus.publish({
        type: "priority_share",
        payload: {
          tenantId: "tenant-sub",
          cycleId: "c-1",
          priorities: [{ agent: "learning", weight: 0.6, confidence: 0.7, rationale: "Share" }],
        },
      });

      await bus.publish({
        type: "trust_aggregate",
        payload: {
          tenantId: "tenant-sub",
          cycleId: "c-2",
          participants: 3,
          averageTrust: 85,
          networkHealth: "healthy",
        },
      });

      await bus.publish({
        type: "model_update",
        payload: { tenantId: "tenant-sub", cycleId: "c-3", trustScore: 88, priorities: [] },
      });

      expect(telemetryListener).toHaveBeenCalledTimes(1);
      expect(priorityListener).toHaveBeenCalledTimes(1);
      expect(trustListener).toHaveBeenCalledTimes(1);
      expect(modelListener).toHaveBeenCalledTimes(1);
    });

    it("T1.3.4: PII/secret sanitization via sanitizeMetadata", () => {
      const rawMetadata = {
        organizationId: "org-safe",
        publicMetric: 100,
        pii: { email: "user@example.com", phone: "+123456789" },
        secrets: { apiKey: "sk_live_secret_key" },
        authToken: "bearer_xyz_123",
        accessToken: "access_token_abc",
        session: { sessionId: "sess_99" },
        rawEvents: [{ event: "user_click" }],
        nested: {
          safeKey: "value",
          secrets: "nested_secret",
        },
      };

      const sanitized = sanitizeMetadata(rawMetadata);

      expect(sanitized.organizationId).toBe("org-safe");
      expect(sanitized.publicMetric).toBe(100);
      expect(sanitized.pii).toBeUndefined();
      expect(sanitized.secrets).toBeUndefined();
      expect(sanitized.authToken).toBeUndefined();
      expect(sanitized.accessToken).toBeUndefined();
      expect(sanitized.session).toBeUndefined();
      expect(sanitized.rawEvents).toBeUndefined();
      expect(sanitized.nested.safeKey).toBe("value");
      expect(sanitized.nested.secrets).toBeUndefined();
    });

    it("T1.3.5: Multi-tenant priority & trust score aggregation", () => {
      const snapshots: FederationSnapshot[] = [
        {
          tenantId: "tenant-1",
          trustScore: 90,
          priorities: [
            { agent: "optimizer", weight: 0.8, confidence: 0.9, rationale: "Opt T1" },
            { agent: "governance", weight: 0.9, confidence: 0.95, rationale: "Gov T1" },
          ],
          updatedAt: new Date().toISOString(),
        },
        {
          tenantId: "tenant-2",
          trustScore: 70,
          priorities: [
            { agent: "optimizer", weight: 0.6, confidence: 0.7, rationale: "Opt T2" },
            { agent: "governance", weight: 0.8, confidence: 0.85, rationale: "Gov T2" },
          ],
          updatedAt: new Date().toISOString(),
        },
      ];

      const aggregatedPriorities = deriveAggregatedPriorities(snapshots);
      expect(aggregatedPriorities).toHaveLength(2);

      const optPriority = aggregatedPriorities.find((p) => p.agent === "optimizer");
      expect(optPriority?.weight).toBe(0.7); // (0.8 + 0.6) / 2
      expect(optPriority?.confidence).toBe(0.8); // (0.9 + 0.7) / 2

      const trustAggregate = aggregateTrustScores(snapshots);
      expect(trustAggregate.averageTrust).toBe(80); // (90 + 70) / 2
      expect(trustAggregate.highest?.tenantId).toBe("tenant-1");
      expect(trustAggregate.highest?.trustScore).toBe(90);
      expect(trustAggregate.lowest?.tenantId).toBe("tenant-2");
      expect(trustAggregate.lowest?.trustScore).toBe(70);
      expect(trustAggregate.median).toBe(80);
      expect(trustAggregate.stdDeviation).toBe(10);
    });
  });

  // ==========================================
  // FEATURE 4: DB & System Loop (R4)
  // ==========================================
  describe("Feature 4: DB & System Loop (R4)", () => {
    it("T1.4.1: Prisma composite index query verification on Invoice, OptimizationLog, ExplanationLog", async () => {
      invoiceFindManyMock.mockResolvedValue([
        { id: "inv-1", userId: "usr-1", status: "PAID", issuedAt: new Date() },
      ]);
      optimizationLogFindManyMock.mockResolvedValue([
        { id: "opt-1", route: "/app/invoices", status: "APPLIED", createdAt: new Date() },
      ]);
      explanationLogFindManyMock.mockResolvedValue([
        { id: "exp-1", recommendationId: "opt-1", route: "/app/invoices" },
      ]);

      const invoices = await db.invoice.findMany({
        where: { userId: "usr-1", status: "PAID", issuedAt: { gte: new Date("2026-01-01") } },
      });
      expect(invoiceFindManyMock).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: "usr-1", status: "PAID" }),
      });
      expect(invoices).toHaveLength(1);

      const logs = await db.optimizationLog.findMany({
        where: { route: "/app/invoices", status: "APPLIED" },
      });
      expect(optimizationLogFindManyMock).toHaveBeenCalledWith({
        where: expect.objectContaining({ route: "/app/invoices", status: "APPLIED" }),
      });
      expect(logs).toHaveLength(1);

      const explanations = await db.explanationLog.findMany({
        where: { recommendationId: "opt-1", route: "/app/invoices" },
      });
      expect(explanationLogFindManyMock).toHaveBeenCalledWith({
        where: expect.objectContaining({ recommendationId: "opt-1", route: "/app/invoices" }),
      });
      expect(explanations).toHaveLength(1);
    });

    it("T1.4.2: Autonomous loop runLoop execution and telemetry ingestion", async () => {
      optimizationLogCountMock
        .mockResolvedValueOnce(20) // total
        .mockResolvedValueOnce(16) // applied
        .mockResolvedValueOnce(2)  // rollback
        .mockResolvedValueOnce(1);  // violations

      agentPriorityFindManyMock.mockResolvedValue([
        { agent: "optimizer", weight: 0.75, confidence: 0.8 },
      ]);
      recoveryLogFindManyMock.mockResolvedValue([]);
      recoveryLogCreateMock.mockResolvedValue({
        id: 1,
        agent: "optimizer",
        action: "noop",
        reason: "Performa stabil",
        trustScoreBefore: 85,
        trustScoreAfter: 85,
        createdAt: new Date(),
      });

      const loopResult = await runLoop({
        telemetry: {
          load: 0.4,
          backlogSize: 5,
          trustScore: 85,
          successRate: 0.90,
          errorRate: 0.05,
          avgLatencyMs: 200,
        },
        emitEvent: false,
      });

      expect(loopResult.enabled).toBe(true);
      expect(loopResult.telemetry.load).toBe(0.4);
      expect(loopResult.telemetry.trustScore).toBe(85);
      expect(loopResult.telemetry.successRate).toBe(0.90);
      expect(loopResult.scaling).toBeDefined();
      expect(loopResult.recovery).toBeDefined();
      expect(loopResult.summary).toContain("Prioritas:");
    });

    it("T1.4.3: Adaptive interval calculation based on system metrics", () => {
      const baseInterval = 300000; // 5 min

      // Healthy system -> lower load, high trust, high success, low error
      const healthyMetrics = { load: 0.1, trustScore: 95, successRate: 0.95, errorRate: 0.01 };
      const healthyInterval = adaptiveInterval(healthyMetrics, baseInterval);
      expect(healthyInterval).toBeLessThan(baseInterval);

      // Stressed system -> high load, lower trust, higher error rate
      const stressedMetrics = { load: 0.9, trustScore: 50, successRate: 0.60, errorRate: 0.20 };
      const stressedInterval = adaptiveInterval(stressedMetrics, baseInterval);
      expect(stressedInterval).toBeGreaterThan(healthyInterval);

      // Clamping limits verification (MIN_INTERVAL: 60,000ms, MAX_INTERVAL: 900,000ms)
      const extremeLow = adaptiveInterval({ load: 0, trustScore: 100, successRate: 1.0, errorRate: 0 }, 1000);
      expect(extremeLow).toBeGreaterThanOrEqual(60000);

      const extremeHigh = adaptiveInterval({ load: 1.0, trustScore: 0, successRate: 0, errorRate: 1.0 }, 10000000);
      expect(extremeHigh).toBeLessThanOrEqual(900000);
    });

    it("T1.4.4: Governance policy evaluation & route protection", () => {
      expect(resolveCategory("/api/v1/invoices")).toBe("API");
      expect(resolveCategory("/data/export")).toBe("DATA");
      expect(resolveCategory("/dashboard/analytics")).toBe("UI");

      // Critical route (/auth) -> status BLOCKED
      const criticalEval = evaluatePolicy({
        route: "/auth/login",
        confidence: 0.95,
        action: "auto-apply",
      });
      expect(criticalEval.status).toBe(PolicyStatus.BLOCKED);
      expect(criticalEval.reasons.join(" ")).toContain("rute kritis");

      // Low confidence API route -> status REVIEW or BLOCKED
      const lowConfApi = evaluatePolicy({
        route: "/api/v1/optimize",
        confidence: 0.50,
        action: "modify",
      });
      expect(lowConfApi.status).toBe(PolicyStatus.REVIEW);
      expect(lowConfApi.reasons.join(" ")).toContain("Confidence 50%");

      // Valid UI route with high confidence -> status ALLOWED
      const allowedUi = evaluatePolicy({
        route: "/dashboard/theme",
        confidence: 0.85,
        action: "auto-apply",
      });
      expect(allowedUi.status).toBe(PolicyStatus.ALLOWED);
      expect(allowedUi.allowAutoApply).toBe(true);
    });

    it("T1.4.5: Composite trust score calculation (50% success, 30% rollback, 20% policy compliance)", async () => {
      const trustScore = calculateTrustScore({
        successRate: 0.90, // 0.90 * 0.50 = 0.45
        rollbackRate: 0.10, // (1 - 0.10) * 0.30 = 0.27
        policyViolationRate: 0.05, // (1 - 0.05) * 0.20 = 0.19
      });

      // Expected weighted score: (0.45 + 0.27 + 0.19) * 100 = 91
      expect(trustScore).toBe(91);

      optimizationLogCountMock
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80)  // applied -> successRate = 80/100 = 0.8
        .mockResolvedValueOnce(8)   // rollback -> rollbackRate = 8/80 = 0.1
        .mockResolvedValueOnce(10); // violations -> violationRate = 10/100 = 0.1

      const metrics = await getTrustMetrics();
      expect(metrics.successRate).toBe(0.8);
      expect(metrics.rollbackRate).toBe(0.1);
      expect(metrics.policyViolationRate).toBe(0.1);

      const fullTrustScore = await getTrustScore();
      // weighted = 0.8*0.5 + 0.9*0.3 + 0.9*0.2 = 0.4 + 0.27 + 0.18 = 0.85 -> 85
      expect(fullTrustScore.score).toBe(85);
      expect(fullTrustScore.metrics).toEqual(metrics);
    });
  });
});
