import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ExperimentAxis, ExperimentStatus } from "@prisma/client";

// Mocks for DB
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
  },
}));

import {
  BANDIT_DIM,
  ALPHA,
  createIdentityMatrix,
  createZeroVector,
  dotProduct,
  matrixVectorMultiply,
  outerProduct,
  matrixAdd,
  vectorAdd,
  vectorScale,
  invertMatrix,
  extractFeatureVector,
  createInitialBanditState,
  computeLinUCBScore,
  synthesiseVariantPayload,
  recordVariantPerformance,
} from "@/lib/ai/content-local-optimizer";

describe("Empirical Stress Testing — Content Local Optimizer", () => {
  describe("Edge Case 1: Cold Start", () => {
    it("handles zero impressions, zero clicks, zero conversions, zero dwell time", () => {
      const x = extractFeatureVector({
        impressions: 0,
        clicks: 0,
        conversions: 0,
        dwellMs: 0,
        axis: ExperimentAxis.HOOK,
        tone: "bold",
        targetMetric: "ctr",
      });

      expect(x.length).toBe(8);
      expect(x.every((val) => Number.isFinite(val))).toBe(true);
      expect(x[0]).toBe(1.0);
      expect(x[1]).toBe(0);
      expect(x[2]).toBe(0);
      expect(x[3]).toBe(0);
      expect(x[4]).toBe(0);

      const state = createInitialBanditState();
      const score = computeLinUCBScore(x, state);

      expect(Number.isFinite(score.ucbScore)).toBe(true);
      expect(Number.isFinite(score.predictedReward)).toBe(true);
      expect(Number.isFinite(score.uncertainty)).toBe(true);
      expect(Number.isFinite(score.confidence)).toBe(true);
      expect(score.predictedReward).toBe(0);
      expect(score.confidence).toBeGreaterThanOrEqual(0.50);
      expect(score.confidence).toBeLessThanOrEqual(0.95);
    });

    it("synthesises variant payload cleanly on cold start", () => {
      const res = synthesiseVariantPayload(ExperimentAxis.HOOK, { hook: "Cold Start Test" }, 0);
      expect(res.payload.hook).toBeDefined();
      expect(Number.isFinite(res.confidence)).toBe(true);
      expect(Number.isFinite(res.ucbScore)).toBe(true);
      expect(res.confidence).toBeGreaterThanOrEqual(0.50);
      expect(res.confidence).toBeLessThanOrEqual(0.95);
    });
  });

  describe("Edge Case 2: High Volume with 0 Conversions", () => {
    it("remains numerically stable under 100,000 impressions, 5,000 clicks, 0 conversions", () => {
      const x = extractFeatureVector({
        impressions: 100000,
        clicks: 5000,
        conversions: 0,
        dwellMs: 300000000, // high total dwell time
        axis: ExperimentAxis.HOOK,
        tone: "bold",
        targetMetric: "ctr",
      });

      expect(x[1]).toBeCloseTo(0.05, 4); // 5000 / 100000
      expect(x[2]).toBe(0);
      expect(x[3]).toBeCloseTo(0.05, 4); // 300000000 / 100000 / 60000 = 0.05
      expect(x[4]).toBe(1.0); // Math.log10(100001)/4 clamped to 1.0

      let state = createInitialBanditState();
      const outer = outerProduct(x);

      // Simulate 500 updates accumulating in matrix A & vector b
      for (let i = 0; i < 500; i++) {
        state = {
          A: matrixAdd(state.A, outer),
          b: vectorAdd(state.b, vectorScale(x, 0.15)), // reward 0.15 from CTR/dwell
          sampleCount: state.sampleCount + 1,
        };
      }

      const score = computeLinUCBScore(x, state);

      expect(Number.isFinite(score.ucbScore)).toBe(true);
      expect(Number.isFinite(score.predictedReward)).toBe(true);
      expect(Number.isFinite(score.uncertainty)).toBe(true);
      expect(Number.isFinite(score.confidence)).toBe(true);
      expect(score.uncertainty).toBeLessThan(0.1);
      expect(score.confidence).toBeCloseTo(0.95, 2);
    });
  });

  describe("Edge Case 3: Extreme Inputs (Negative, NaN, Infinity, >24h Dwell)", () => {
    it("clamps negative metrics safely without producing NaNs or negative features", () => {
      const x = extractFeatureVector({
        impressions: -500,
        clicks: -100,
        conversions: -10,
        dwellMs: -99999,
        axis: ExperimentAxis.HOOK,
      });

      expect(x.every((val) => Number.isFinite(val))).toBe(true);
      expect(x[1]).toBe(0);
      expect(x[2]).toBe(0);
      expect(x[3]).toBe(0);
      expect(x[4]).toBe(0);
    });

    it("handles NaN metrics without crashing or returning NaN", () => {
      const x = extractFeatureVector({
        impressions: NaN,
        clicks: NaN,
        conversions: NaN,
        dwellMs: NaN,
        axis: ExperimentAxis.HOOK,
      });

      expect(x.every((val) => Number.isFinite(val))).toBe(true);
      expect(x[1]).toBe(0);
      expect(x[2]).toBe(0);
      expect(x[3]).toBe(0);
      expect(x[4]).toBe(0);

      const state = createInitialBanditState();
      const score = computeLinUCBScore(x, state);

      expect(Number.isFinite(score.ucbScore)).toBe(true);
      expect(Number.isFinite(score.predictedReward)).toBe(true);
      expect(Number.isFinite(score.uncertainty)).toBe(true);
      expect(Number.isFinite(score.confidence)).toBe(true);
    });

    it("handles Infinity metrics safely", () => {
      const x = extractFeatureVector({
        impressions: Infinity,
        clicks: Infinity,
        conversions: Infinity,
        dwellMs: Infinity,
        axis: ExperimentAxis.HOOK,
      });

      expect(x.every((val) => Number.isFinite(val))).toBe(true);
      expect(x[1]).toBe(0);
      expect(x[2]).toBe(0);
      expect(x[3]).toBe(0);
      expect(x[4]).toBe(0);
    });

    it("handles extreme dwell times (> 24 hours = 86,400,000ms) with proper clamping", () => {
      const x = extractFeatureVector({
        impressions: 1,
        clicks: 1,
        conversions: 1,
        dwellMs: 100000000, // ~27 hours
        axis: ExperimentAxis.HOOK,
      });

      expect(x.every((val) => Number.isFinite(val))).toBe(true);
      expect(x[3]).toBe(1.0); // clamped to max 1.0
    });
  });

  describe("Edge Case 4: Singular or Ill-Conditioned Covariance Matrix A", () => {
    it("falls back to identity matrix on all-zeros matrix", () => {
      const zeroMatrix = Array(BANDIT_DIM)
        .fill(0)
        .map(() => Array(BANDIT_DIM).fill(0));

      const inv = invertMatrix(zeroMatrix);
      expect(inv).toEqual(createIdentityMatrix(BANDIT_DIM));
    });

    it("falls back to identity matrix on linearly dependent / rank 1 matrix", () => {
      // Matrix of all 1s has rank 1 (singular for N >= 2)
      const rankOneMatrix = Array(BANDIT_DIM)
        .fill(0)
        .map(() => Array(BANDIT_DIM).fill(1));

      const inv = invertMatrix(rankOneMatrix);
      expect(inv).toEqual(createIdentityMatrix(BANDIT_DIM));
    });

    it("handles matrix with near-zero pivot (< 1e-12) gracefully", () => {
      const A = createIdentityMatrix(BANDIT_DIM);
      A[3][3] = 1e-13; // near zero pivot

      const inv = invertMatrix(A);
      expect(inv).toEqual(createIdentityMatrix(BANDIT_DIM));
    });

    it("handles ill-conditioned matrix with huge scale disparity (1e15 vs 1e-15)", () => {
      const A = createIdentityMatrix(BANDIT_DIM);
      A[0][0] = 1e15;
      A[7][7] = 1e-15;

      const inv = invertMatrix(A);
      expect(inv.every((row) => row.every((val) => Number.isFinite(val)))).toBe(true);
    });

    it("computes LinUCB score gracefully even when state.A is singular or corrupted", () => {
      const x = extractFeatureVector({ impressions: 10, clicks: 2 });
      const corruptedState = {
        A: Array(BANDIT_DIM)
          .fill(0)
          .map(() => Array(BANDIT_DIM).fill(0)), // singular zero matrix
        b: [0, 0, 0, 0, 0, 0, 0, 0],
        sampleCount: 5,
      };

      const score = computeLinUCBScore(x, corruptedState);

      expect(Number.isFinite(score.ucbScore)).toBe(true);
      expect(Number.isFinite(score.uncertainty)).toBe(true);
      expect(Number.isFinite(score.confidence)).toBe(true);
      expect(score.confidence).toBeGreaterThanOrEqual(0.50);
      expect(score.confidence).toBeLessThanOrEqual(0.95);
    });
  });

  describe("End-to-End Performance Update Stress Test", () => {
    beforeEach(() => {
      variantFindUniqueMock.mockReset();
      metricFindFirstMock.mockReset();
      metricCreateMock.mockReset();
      metricUpdateMock.mockReset();
      variantUpdateMock.mockReset();
    });

    it("records performance under extreme metrics without breaking database payload", async () => {
      const mockVariant = {
        id: 999,
        experimentId: 1,
        variantKey: "test-variant",
        payload: {
          hook: "Test",
          metadata: {
            banditState: createInitialBanditState(),
          },
        },
        confidence: 0.66,
        experiment: { axis: ExperimentAxis.HOOK },
        metrics: [],
      };

      variantFindUniqueMock.mockResolvedValue(mockVariant);
      metricFindFirstMock.mockResolvedValue(null);
      metricCreateMock.mockResolvedValue({
        id: 10,
        variantId: 999,
        impressions: 100000,
        clicks: 5000,
        conversions: 0,
        dwellMs: 300000000,
        ctr: 0.05,
      });
      variantUpdateMock.mockResolvedValue({ id: 999 });

      const res = await recordVariantPerformance({
        variantId: 999,
        impressions: 100000,
        clicks: 5000,
        conversions: 0,
        dwellMs: 300000000,
      });

      expect(res.impressions).toBe(100000);
      expect(res.conversions).toBe(0);
      expect(variantUpdateMock).toHaveBeenCalledTimes(1);

      const updateData = variantUpdateMock.mock.calls[0][0].data;
      expect(Number.isFinite(updateData.confidence)).toBe(true);
      expect(updateData.confidence).toBeGreaterThanOrEqual(0.50);
      expect(updateData.confidence).toBeLessThanOrEqual(0.95);
    });
  });
});
