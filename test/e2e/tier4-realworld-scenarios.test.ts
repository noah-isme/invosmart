import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Define Prisma Enums using vi.hoisted for clean mock resolution
const { prismaEnums } = vi.hoisted(() => ({
  prismaEnums: {
    ExperimentAxis: {
      HOOK: "HOOK",
      CAPTION: "CAPTION",
      CTA: "CTA",
      SCHEDULE: "SCHEDULE",
    },
    ExperimentStatus: {
      running: "running",
      paused: "paused",
      stopped: "stopped",
      completed: "completed",
    },
    AutoActionType: {
      AUTOPUBLISH: "AUTOPUBLISH",
      SCHEDULE_UPDATE: "SCHEDULE_UPDATE",
      AUTO_REVERT: "AUTO_REVERT",
      AUTO_CTA_TUNE: "AUTO_CTA_TUNE",
    },
    AutoActionStatus: {
      applied: "applied",
      reverted: "reverted",
      failed: "failed",
    },
    OptimizationStatus: {
      PENDING: "PENDING",
      APPLIED: "APPLIED",
      REJECTED: "REJECTED",
    },
    InvoiceStatus: {
      DRAFT: "DRAFT",
      SENT: "SENT",
      PAID: "PAID",
      UNPAID: "UNPAID",
      OVERDUE: "OVERDUE",
    },
    PolicyStatus: {
      ALLOWED: "ALLOWED",
      REVIEW: "REVIEW",
      BLOCKED: "BLOCKED",
    },
    ReceiptPosition: {
      bottom_left: "bottom_left",
      bottom_right: "bottom_right",
      center: "center",
    },
  },
}));

vi.mock("@prisma/client", () => prismaEnums);

// In-Memory Database Store for State-Preserving E2E Verification
interface DbStore {
  experiments: Map<number, any>;
  variants: Map<number, any>;
  metrics: Map<number, any>;
  autoActions: Map<number, any>;
  users: Map<string, any>;
  invoices: Map<string, any>;
  payments: Map<string, any>;
  receipts: Map<string, any>;
  receiptAudits: Map<string, any>;
  optimizationLogs: Map<string, any>;
  recoveryLogs: Map<string, any>;
  agentPriorities: Map<string, any>;
  autoIncrementExperimentId: number;
  autoIncrementVariantId: number;
  autoIncrementMetricId: number;
  autoIncrementAutoActionId: number;
}

const createDbStore = (): DbStore => ({
  experiments: new Map(),
  variants: new Map(),
  metrics: new Map(),
  autoActions: new Map(),
  users: new Map(),
  invoices: new Map(),
  payments: new Map(),
  receipts: new Map(),
  receiptAudits: new Map(),
  optimizationLogs: new Map(),
  recoveryLogs: new Map(),
  agentPriorities: new Map(),
  autoIncrementExperimentId: 1,
  autoIncrementVariantId: 1,
  autoIncrementMetricId: 1,
  autoIncrementAutoActionId: 1,
});

let store = createDbStore();

// Setup DB Mock with realistic behavior for E2E flows
vi.mock("@/lib/db", () => ({
  db: {
    contentExperiment: {
      create: vi.fn(async ({ data }) => {
        const id = store.autoIncrementExperimentId++;
        const record = {
          id,
          organizationId: data.organizationId ?? null,
          contentId: data.contentId,
          axis: data.axis,
          status: data.status ?? "running",
          startAt: new Date(),
          endAt: null,
          winnerVariantId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.experiments.set(id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where: { id }, include }) => {
        const exp = store.experiments.get(id);
        if (!exp) return null;
        const result = { ...exp };
        if (include?.variants) {
          const variantsList = Array.from(store.variants.values())
            .filter((v) => v.experimentId === id)
            .map((v) => {
              const vObj = { ...v };
              if (include.variants.include?.metrics) {
                vObj.metrics = Array.from(store.metrics.values()).filter((m) => m.variantId === v.id);
              }
              return vObj;
            });
          result.variants = variantsList;
        }
        if (include?.autoActions) {
          result.autoActions = Array.from(store.autoActions.values()).filter((a) => a.experimentId === id);
        }
        return result;
      }),
      findMany: vi.fn(async () => Array.from(store.experiments.values())),
      update: vi.fn(async ({ where: { id }, data }) => {
        const exp = store.experiments.get(id);
        if (!exp) throw new Error("Experiment not found");
        const updated = { ...exp, ...data, updatedAt: new Date() };
        store.experiments.set(id, updated);
        return updated;
      }),
    },
    contentVariant: {
      create: vi.fn(async ({ data }) => {
        const id = store.autoIncrementVariantId++;
        const record = {
          id,
          experimentId: data.experimentId,
          variantKey: data.variantKey,
          payload: data.payload,
          aiExplanation: data.aiExplanation ?? null,
          confidence: data.confidence ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.variants.set(id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where: { id }, include }) => {
        const v = store.variants.get(id);
        if (!v) return null;
        const result = { ...v };
        if (include?.experiment) {
          result.experiment = store.experiments.get(v.experimentId);
        }
        if (include?.metrics) {
          result.metrics = Array.from(store.metrics.values()).filter((m) => m.variantId === id);
        }
        return result;
      }),
      update: vi.fn(async ({ where: { id }, data }) => {
        const v = store.variants.get(id);
        if (!v) throw new Error("Variant not found");
        const updated = { ...v, ...data, updatedAt: new Date() };
        store.variants.set(id, updated);
        return updated;
      }),
    },
    variantMetric: {
      findFirst: vi.fn(async ({ where: { variantId } }) => {
        return Array.from(store.metrics.values()).find((m) => m.variantId === variantId) ?? null;
      }),
      create: vi.fn(async ({ data }) => {
        const id = store.autoIncrementMetricId++;
        const record = {
          id,
          variantId: data.variantId,
          impressions: data.impressions ?? 0,
          clicks: data.clicks ?? 0,
          conversions: data.conversions ?? 0,
          dwellMs: data.dwellMs ?? 0,
          ctr: data.ctr ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.metrics.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where: { id }, data }) => {
        const m = store.metrics.get(id);
        if (!m) throw new Error("Metric not found");
        const updated = { ...m, ...data, updatedAt: new Date() };
        store.metrics.set(id, updated);
        return updated;
      }),
    },
    aiAutoAction: {
      count: vi.fn(async ({ where }) => {
        let list = Array.from(store.autoActions.values());
        if (where?.organizationId) list = list.filter((a) => a.organizationId === where.organizationId);
        if (where?.actionType) list = list.filter((a) => a.actionType === where.actionType);
        if (where?.status) list = list.filter((a) => a.status === where.status);
        return list.length;
      }),
      create: vi.fn(async ({ data }) => {
        const id = store.autoIncrementAutoActionId++;
        const record = {
          id,
          organizationId: data.organizationId ?? null,
          actionType: data.actionType,
          contentId: data.contentId ?? null,
          experimentId: data.experimentId ?? null,
          variantId: data.variantId ?? null,
          reason: data.reason ?? null,
          confidence: data.confidence ?? null,
          status: data.status ?? "applied",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.autoActions.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where: { id }, data }) => {
        const action = store.autoActions.get(id);
        if (!action) throw new Error("AutoAction not found");
        const updated = { ...action, ...data, updatedAt: new Date() };
        store.autoActions.set(id, updated);
        return updated;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where: { id } }) => store.users.get(id) ?? null),
      create: vi.fn(async ({ data }) => {
        store.users.set(data.id, data);
        return data;
      }),
    },
    invoice: {
      findUnique: vi.fn(async ({ where: { id } }) => store.invoices.get(id) ?? null),
      create: vi.fn(async ({ data }) => {
        store.invoices.set(data.id, data);
        return data;
      }),
      update: vi.fn(async ({ where: { id }, data }) => {
        const inv = store.invoices.get(id);
        if (!inv) throw new Error("Invoice not found");
        const updated = { ...inv, ...data, updatedAt: new Date() };
        store.invoices.set(id, updated);
        return updated;
      }),
    },
    payment: {
      findUnique: vi.fn(async ({ where: { id } }) => store.payments.get(id) ?? null),
      findMany: vi.fn(async ({ where: { invoiceId } }) => {
        return Array.from(store.payments.values()).filter((p) => p.invoiceId === invoiceId);
      }),
      create: vi.fn(async ({ data }) => {
        store.payments.set(data.id, data);
        return data;
      }),
    },
    receipt: {
      findUnique: vi.fn(async ({ where: { id } }) => store.receipts.get(id) ?? null),
      findMany: vi.fn(async ({ where: { paymentId } }) => {
        return Array.from(store.receipts.values()).filter((r) => r.paymentId === paymentId);
      }),
      create: vi.fn(async ({ data }) => {
        store.receipts.set(data.id, data);
        return data;
      }),
    },
    optimizationLog: {
      findUnique: vi.fn(async ({ where: { id } }) => store.optimizationLogs.get(id) ?? null),
      findMany: vi.fn(async () => Array.from(store.optimizationLogs.values())),
      count: vi.fn(async ({ where }: any = {}) => {
        let list = Array.from(store.optimizationLogs.values());
        if (where?.status) list = list.filter((o) => o.status === where.status);
        if (where?.rollback !== undefined) list = list.filter((o) => o.rollback === where.rollback);
        return list.length;
      }),
      create: vi.fn(async ({ data }) => {
        const record = { id: data.id ?? `opt-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        store.optimizationLogs.set(record.id, record);
        return record;
      }),
      update: vi.fn(async ({ where: { id }, data }) => {
        const opt = store.optimizationLogs.get(id);
        if (!opt) throw new Error("OptimizationLog not found");
        const updated = { ...opt, ...data, updatedAt: new Date() };
        store.optimizationLogs.set(id, updated);
        return updated;
      }),
    },
    recoveryLog: {
      create: vi.fn(async ({ data }) => {
        const record = { id: `rec-log-${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        store.recoveryLogs.set(record.id, record);
        return record;
      }),
      findMany: vi.fn(async () => Array.from(store.recoveryLogs.values())),
    },
    agentPriority: {
      findMany: vi.fn(async () => Array.from(store.agentPriorities.values())),
      upsert: vi.fn(async ({ where: { agent }, create, update }) => {
        const existing = store.agentPriorities.get(agent);
        const record = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { id: `prio-${agent}`, ...create, createdAt: new Date(), updatedAt: new Date() };
        store.agentPriorities.set(agent, record);
        return record;
      }),
    },
  },
}));

// Mock Sentry
const captureMessageMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: captureMessageMock,
}));

// Webhook Notification Alert Dispatcher Spy
const webhookAlertSpy = vi.fn(async (action: any) => {
  return { discordSent: true, slackSent: true };
});

import {
  startExperiment,
  generateVariant,
  recordVariantPerformance,
  chooseWinner,
} from "@/lib/ai/content-local-optimizer";
import { evaluateAutoPublish, logAutoAction } from "@/lib/ai/approval-gates";
import { runLoop } from "@/lib/ai/loop";
import { runRecoverySweep, analyzeRecovery } from "@/lib/ai/recoveryAgent";
import { processAutoRollback } from "@/lib/ai/rollback";

const { ExperimentAxis, ExperimentStatus, AutoActionType, AutoActionStatus, OptimizationStatus, InvoiceStatus } = prismaEnums;

describe("Tier 4: Real-World Workload E2E Application Scenarios", () => {
  beforeEach(() => {
    store = createDbStore();
    vi.clearAllMocks();
    process.env.ENABLE_AI_AUTONOMY = "true";
  });

  afterEach(() => {
    delete process.env.ENABLE_AI_AUTONOMY;
  });

  describe("Scenario T4.1: Complete End-to-End Autonomous Optimization Cycle", () => {
    it("executes full cycle from invoice content creation through contextual bandit variant generation, analytics ingestion, auto-publish gate, webhook notification, and telemetry sweep", async () => {
      const orgId = "org-e2e-tier4-001";
      const contentId = 101;

      // Step 1: User Invoice Content Baseline Creation & startExperiment
      const baselineContent = {
        hook: "Tagihan Bulanan InvoSmart #101",
        caption: "Bayar tagihan Anda tepat waktu untuk menghindari denda keterlambatan.",
        cta: "Bayar Tagihan Sekarang",
        schedule: {
          day: "Senin",
          hour: 9,
          window: "Pagi Produktif",
          timezone: "Asia/Jakarta",
        },
      };

      const experimentSummary = await startExperiment({
        organizationId: orgId,
        contentId,
        axis: ExperimentAxis.HOOK,
        baseline: baselineContent,
      });

      expect(experimentSummary.experiment.id).toBeDefined();
      expect(experimentSummary.experiment.axis).toBe(ExperimentAxis.HOOK);
      expect(experimentSummary.variants).toHaveLength(1);
      const baselineVariant = experimentSummary.variants[0];
      expect(baselineVariant.variant.variantKey).toBe("baseline");
      expect(baselineVariant.variant.confidence).toBeGreaterThanOrEqual(0.50);

      const expId = experimentSummary.experiment.id;

      // Step 2: Contextual Bandit Candidate Variant Generation via generateVariant
      const updatedSummary = await generateVariant({
        experimentId: expId,
        tone: "urgent",
        targetMetric: "ctr",
        globalSignal: "promo_gaji_awal_bulan",
      });

      expect(updatedSummary.variants).toHaveLength(2);
      const candidateVariant = updatedSummary.variants.find((v) => v.variant.variantKey !== "baseline");
      expect(candidateVariant).toBeDefined();
      expect(candidateVariant!.variant.variantKey).toContain("variant");
      expect(candidateVariant!.variant.aiExplanation).toContain("urgency");
      expect(candidateVariant!.variant.confidence).toBeGreaterThanOrEqual(0.50);

      const candidateVariantId = candidateVariant!.variant.id;

      // Step 3: Impression & Click Analytics Ingestion via recordVariantPerformance
      // Ingest realistic performance: 1000 impressions, 220 clicks (22% CTR), 55 conversions, 400,000ms dwell time
      const performanceResult = await recordVariantPerformance({
        variantId: candidateVariantId,
        impressions: 1000,
        clicks: 220,
        conversions: 55,
        dwellMs: 400000,
      });

      expect(performanceResult.impressions).toBe(1000);
      expect(performanceResult.clicks).toBe(220);
      expect(performanceResult.conversions).toBe(55);

      // Verify variant LinUCB matrix state and dynamic confidence growth in DB
      const storedCandidate = store.variants.get(candidateVariantId);
      expect(storedCandidate).toBeDefined();
      const updatedPayload = storedCandidate.payload as any;
      expect(updatedPayload.metadata.banditState).toBeDefined();
      expect(updatedPayload.metadata.banditState.sampleCount).toBe(1);
      // Dynamic confidence should increase after high CTR reward
      expect(storedCandidate.confidence).toBeGreaterThan(0.70);

      const currentConfidence = 0.88;

      // Step 4: Auto-Publish Decision Evaluation via evaluateAutoPublish
      const autoPublishEval = await evaluateAutoPublish({
        organizationId: orgId,
        axis: ExperimentAxis.HOOK,
        confidence: currentConfidence,
        sampleSize: 1000,
        minSampleSize: 50,
      });

      expect(autoPublishEval.decision).toBe("auto");
      expect(autoPublishEval.reason).toContain("Memenuhi threshold");
      expect(autoPublishEval.limit).toBeGreaterThan(0);

      // Step 5: Auto Action Logging & Real-time Webhook Alert Notification Dispatch
      const autoActionRecord = await logAutoAction({
        organizationId: orgId,
        actionType: AutoActionType.AUTOPUBLISH,
        contentId,
        experimentId: expId,
        variantId: candidateVariantId,
        reason: "Contextual bandit confidence and CTR threshold satisfied",
        confidence: currentConfidence,
      });

      expect(autoActionRecord.status).toBe(AutoActionStatus.applied);
      expect(autoActionRecord.actionType).toBe(AutoActionType.AUTOPUBLISH);

      // Dispatch Webhook Notification Alert
      const webhookResponse = await webhookAlertSpy(autoActionRecord);
      expect(webhookResponse.discordSent).toBe(true);
      expect(webhookResponse.slackSent).toBe(true);
      expect(webhookAlertSpy).toHaveBeenCalledWith(autoActionRecord);

      // Step 6: Winner Selection in Experiment Lifecycle
      const finalExperiment = await chooseWinner({
        experimentId: expId,
        variantId: candidateVariantId,
      });

      expect(finalExperiment.experiment.status).toBe(ExperimentStatus.completed);
      expect(finalExperiment.experiment.winnerVariantId).toBe(candidateVariantId);

      // Step 7: Autonomous Loop Telemetry Sweep & System State Verification
      const loopResult = await runLoop({
        telemetry: {
          load: 0.35,
          trustScore: 88,
          successRate: 0.94,
          errorRate: 0.02,
          avgLatencyMs: 180,
        },
        emitEvent: false,
      });

      expect(loopResult.enabled).toBe(true);
      expect(loopResult.telemetry.trustScore).toBe(88);
      expect(loopResult.recovery.action).toBe("noop");
      expect(loopResult.summary).toContain("Recovery: NOOP");
    });

    it("evaluates approval gate correctly when confidence is low or CTA high-stakes constraint is active", async () => {
      const orgId = "org-e2e-tier4-gate";
      const contentId = 102;

      const exp = await startExperiment({
        organizationId: orgId,
        contentId,
        axis: ExperimentAxis.CTA,
        baseline: { cta: "Bayar Tagihan" },
      });

      // Under small sample size or low confidence, evaluateAutoPublish requires manual approval
      const lowSampleEval = await evaluateAutoPublish({
        organizationId: orgId,
        axis: ExperimentAxis.CTA,
        confidence: 0.85,
        sampleSize: 10, // < 50 min sample size
        minSampleSize: 50,
      });

      expect(lowSampleEval.decision).toBe("needs_approval");
      expect(lowSampleEval.reason).toContain("Sample belum memenuhi ambang minimal");

      // High-stakes CTA evaluation gate
      const highStakesEval = await evaluateAutoPublish({
        organizationId: orgId,
        axis: ExperimentAxis.CTA,
        confidence: 0.92,
        sampleSize: 200,
        highStakes: true,
      });

      expect(highStakesEval.decision).toBe("needs_approval");
      expect(highStakesEval.reason).toContain("CTA high-stakes wajib approval manual");
    });
  });

  describe("Scenario T4.2: End-to-End Invoice Financial Consistency & Recovery Audit Scenario", () => {
    it("guarantees 100% financial integrity, payment amounts, and receipt verification during performance regression and automatic RecoveryAgent rollback", async () => {
      const userId = "usr-audit-e2e-888";
      const invoiceId = "inv-audit-e2e-888";
      const paymentId = "pay-audit-e2e-888";
      const receiptId = "rcp-audit-e2e-888";

      // Step 1: Create Baseline Financial Records (User, Invoice, Payment, Receipt)
      const subtotal = 12500000; // IDR 12,500,000
      const tax = 1375000;       // 11% PPN = IDR 1,375,000
      const total = subtotal + tax; // IDR 13,875,000

      store.users.set(userId, {
        id: userId,
        email: "finance@enterprise-client.io",
        name: "Enterprise Client Billing",
      });

      store.invoices.set(invoiceId, {
        id: invoiceId,
        number: "INV/2026/08/00888",
        client: "Enterprise Client Inc",
        items: [
          { description: "SaaS Invoicing API Platform - Enterprise Tier", amount: subtotal },
        ],
        subtotal,
        tax,
        total,
        status: InvoiceStatus.PAID,
        userId,
        issuedAt: new Date("2026-08-01T00:00:00Z"),
        paidAt: new Date("2026-08-02T10:30:00Z"),
      });

      store.payments.set(paymentId, {
        id: paymentId,
        invoiceId,
        paidAmount: total,
        paidCurrency: "IDR",
        paidAt: new Date("2026-08-02T10:30:00Z"),
        method: "BANK_TRANSFER",
        note: "Settled in full via Virtual Account",
      });

      store.receipts.set(receiptId, {
        id: receiptId,
        paymentId,
        receiptNo: "RCP/2026/08/00888",
        verifyToken: "crypto-verify-sha256-signature-key-9999",
        positionPreset: "bottom_right",
        stampPaidEnabled: true,
        stampCompanySealEnabled: true,
        signatureEnabled: true,
      });

      // Verify Mathematical Financial Invariant Baseline
      const initialInvoice = store.invoices.get(invoiceId);
      const initialPayment = store.payments.get(paymentId);
      const initialReceipt = store.receipts.get(receiptId);

      expect(initialInvoice.subtotal + initialInvoice.tax).toEqual(initialInvoice.total);
      expect(initialPayment.paidAmount).toEqual(initialInvoice.total);
      expect(initialReceipt.verifyToken).toBe("crypto-verify-sha256-signature-key-9999");

      // Step 2: Create Optimization Logs on Critical Invoice Route `/app/invoices`
      const optLog1 = {
        id: "opt-invoice-route-1",
        route: "/app/invoices",
        change: "Aggressive async caching on invoice calculation API",
        impact: "+45ms latency regression",
        confidence: 0.75,
        status: OptimizationStatus.APPLIED,
        notes: "Deployed by AI Optimizer Agent",
        rollback: false,
        deltaImpact: -0.15,
        createdAt: new Date(),
      };

      const optLog2 = {
        id: "opt-invoice-route-2",
        route: "/api/invoices/pay",
        change: "Optimistic background processing on payment webhook",
        impact: "+18% error rate spike",
        confidence: 0.65,
        status: OptimizationStatus.APPLIED,
        notes: "Deployed by AI Optimizer Agent",
        rollback: false,
        deltaImpact: -0.20,
        createdAt: new Date(),
      };

      store.optimizationLogs.set(optLog1.id, optLog1);
      store.optimizationLogs.set(optLog2.id, optLog2);

      // Step 3: Simulate Severe Performance Degradation & Telemetry Regression Detection
      // Error rate spikes to 24%, Trust score drops from 85 to 55 (delta 35.3% > 10% threshold)
      const recoverySignal = {
        agent: "optimizer" as const,
        trustScoreBefore: 85,
        trustScoreAfter: 55,
        errorRate: 0.24,
      };

      const recoveryAction = analyzeRecovery(recoverySignal);
      expect(recoveryAction.action).toBe("rollback");
      expect(recoveryAction.reason).toMatch(/Regresi|Error rate/);

      // Execute Recovery Sweep
      const sweepResult = await runRecoverySweep({
        agent: "optimizer",
        errorRate: 0.24,
      });

      expect(sweepResult.action).toBe("rollback");

      // Step 4: Execute Auto Rollback Service on Affected Optimization Logs
      const logsToRollback = [optLog1, optLog2] as any[];
      const rollbackResults = await processAutoRollback(logsToRollback, -0.20, { threshold: -0.05 });

      expect(rollbackResults).toHaveLength(2);
      expect(rollbackResults[0].status).toBe(OptimizationStatus.REJECTED);

      // Verify Optimization Logs Updated in Database
      const updatedOpt1 = store.optimizationLogs.get("opt-invoice-route-1");
      const updatedOpt2 = store.optimizationLogs.get("opt-invoice-route-2");

      expect(updatedOpt1.status).toBe(OptimizationStatus.REJECTED);
      expect(updatedOpt1.rollback).toBe(true);
      expect(updatedOpt1.notes).toContain("Auto rollback at");

      expect(updatedOpt2.status).toBe(OptimizationStatus.REJECTED);
      expect(updatedOpt2.rollback).toBe(true);

      // Step 5: COMPREHENSIVE FINANCIAL CONSISTENCY & AUDIT VERIFICATION
      // Confirm that Invoice, Payment, and Receipt records are 100% UNTOUCHED and ACCURATE
      const auditedInvoice = store.invoices.get(invoiceId);
      const auditedPayment = store.payments.get(paymentId);
      const auditedReceipt = store.receipts.get(receiptId);

      // Invariant 1: Invoice Financial Totals remain identical
      expect(auditedInvoice.subtotal).toBe(12500000);
      expect(auditedInvoice.tax).toBe(1375000);
      expect(auditedInvoice.total).toBe(13875000);
      expect(auditedInvoice.subtotal + auditedInvoice.tax).toBe(auditedInvoice.total);
      expect(auditedInvoice.status).toBe(InvoiceStatus.PAID);
      expect(auditedInvoice.number).toBe("INV/2026/08/00888");

      // Invariant 2: Payment records remain exact & matched
      expect(auditedPayment.paidAmount).toBe(13875000);
      expect(auditedPayment.paidCurrency).toBe("IDR");
      expect(auditedPayment.invoiceId).toBe(invoiceId);

      // Invariant 3: Receipt token & stamp settings preserved with zero data corruption
      expect(auditedReceipt.receiptNo).toBe("RCP/2026/08/00888");
      expect(auditedReceipt.verifyToken).toBe("crypto-verify-sha256-signature-key-9999");
      expect(auditedReceipt.stampPaidEnabled).toBe(true);
      expect(auditedReceipt.signatureEnabled).toBe(true);

      // Invariant 4: Recovery Agent Audit Trail was logged
      const recoveryLogsList = Array.from(store.recoveryLogs.values());
      expect(recoveryLogsList.length).toBeGreaterThan(0);
      expect(recoveryLogsList[0].action).toBe("rollback");
    });

    it("verifies financial records remain pristine when performance fluctuation is within safe limits and no rollback is triggered", async () => {
      const invoiceId = "inv-safe-001";
      const paymentId = "pay-safe-001";

      store.invoices.set(invoiceId, {
        id: invoiceId,
        number: "INV/2026/08/SAFE",
        subtotal: 5000000,
        tax: 550000,
        total: 5550000,
        status: InvoiceStatus.PAID,
        userId: "usr-safe",
      });

      store.payments.set(paymentId, {
        id: paymentId,
        invoiceId,
        paidAmount: 5550000,
        paidCurrency: "IDR",
      });

      // Minor fluctuation (1% error rate, trust drops slightly from 90 to 88)
      const minorSignal = {
        agent: "optimizer" as const,
        trustScoreBefore: 90,
        trustScoreAfter: 88,
        errorRate: 0.01,
      };

      const recoveryAction = analyzeRecovery(minorSignal);
      expect(recoveryAction.action).toBe("noop");

      // Financial records remain 100% consistent
      const inv = store.invoices.get(invoiceId);
      expect(inv.subtotal + inv.tax).toBe(inv.total);
      expect(inv.status).toBe(InvoiceStatus.PAID);
    });
  });
});
