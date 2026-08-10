import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExperimentAxis, ExperimentStatus } from "@prisma/client";

// Mocks for DB using vi.hoisted to prevent vitest hoisting errors
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
  ALPHA,
  BANDIT_DIM,
  computeLinUCBScore,
  createIdentityMatrix,
  createInitialBanditState,
  createZeroVector,
  dotProduct,
  extractFeatureVector,
  generateVariant,
  invertMatrix,
  matrixAdd,
  matrixVectorMultiply,
  outerProduct,
  recordVariantPerformance,
  startExperiment,
  synthesiseVariantPayload,
  vectorAdd,
  vectorScale,
} from "@/lib/ai/content-local-optimizer";

describe("LinUCB Matrix Operations & Vector Helpers", () => {
  it("creates identity matrix of dimension 8", () => {
    const I = createIdentityMatrix(8);
    expect(I.length).toBe(8);
    expect(I[0].length).toBe(8);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        expect(I[i][j]).toBe(i === j ? 1.0 : 0.0);
      }
    }
  });

  it("creates zero vector of dimension 8", () => {
    const v = createZeroVector(8);
    expect(v).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("computes dot product of two vectors correctly", () => {
    const u = [1, 2, 3, 4, 5, 6, 7, 8];
    const v = [2, 0, -1, 0.5, 1, 2, 0, 1];
    // 1*2 + 2*0 + 3*(-1) + 4*0.5 + 5*1 + 6*2 + 7*0 + 8*1 = 2 + 0 - 3 + 2 + 5 + 12 + 0 + 8 = 26
    expect(dotProduct(u, v)).toBe(26);
  });

  it("performs matrix-vector multiplication correctly", () => {
    const M = [
      [1, 2],
      [3, 4],
    ];
    const v = [5, 6];
    // [1*5 + 2*6, 3*5 + 4*6] = [17, 39]
    expect(matrixVectorMultiply(M, v)).toEqual([17, 39]);
  });

  it("computes outer product x * x^T", () => {
    const x = [1, 2, 3];
    const outer = outerProduct(x);
    expect(outer).toEqual([
      [1, 2, 3],
      [2, 4, 6],
      [3, 6, 9],
    ]);
  });

  it("adds matrices and vectors correctly", () => {
    const A = [
      [1, 2],
      [3, 4],
    ];
    const B = [
      [5, 6],
      [7, 8],
    ];
    expect(matrixAdd(A, B)).toEqual([
      [6, 8],
      [10, 12],
    ]);

    expect(vectorAdd([1, 2], [3, 4])).toEqual([4, 6]);
    expect(vectorScale([2, -3], 2.5)).toEqual([5, -7.5]);
  });

  it("inverts 8x8 identity matrix", () => {
    const I = createIdentityMatrix(8);
    const invI = invertMatrix(I);
    expect(invI).toEqual(I);
  });

  it("inverts a non-trivial symmetric positive definite 8x8 matrix A", () => {
    const I = createIdentityMatrix(8);
    const x = [1, 0.5, 0.2, 0.1, 0, 1, 0.5, 0.45];
    const outer = outerProduct(x);
    const A = matrixAdd(I, outer);

    const A_inv = invertMatrix(A);

    // Verify A * A_inv ≈ I
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        let sum = 0;
        for (let k = 0; k < 8; k++) {
          sum += A[i][k] * A_inv[k][j];
        }
        expect(sum).toBeCloseTo(i === j ? 1 : 0, 4);
      }
    }
  });

  it("handles singular matrix inversion safely by returning identity matrix fallback", () => {
    const singular = Array(8)
      .fill(0)
      .map(() => Array(8).fill(0));
    const inv = invertMatrix(singular);
    expect(inv).toEqual(createIdentityMatrix(8));
  });
});

describe("Feature Vector Extraction", () => {
  it("extracts 8-dimensional feature vector for cold start defaults", () => {
    const x = extractFeatureVector({
      impressions: 0,
      clicks: 0,
      conversions: 0,
      dwellMs: 0,
      axis: ExperimentAxis.HOOK,
      tone: "bold",
      targetMetric: "ctr",
    });

    expect(x.length).toBe(BANDIT_DIM);
    expect(x[0]).toBe(1.0); // Intercept
    expect(x[1]).toBe(0); // CTR
    expect(x[2]).toBe(0); // Conversion rate
    expect(x[3]).toBe(0); // Normalized dwell
    expect(x[4]).toBe(0); // Log volume
    expect(x[5]).toBe(1.0); // HOOK axis
    expect(x[6]).toBe(1.0); // bold tone
    expect(x[7]).toBe(0.45); // ctr target metric weight
  });

  it("encodes different experiment axes, tones, and target metrics correctly", () => {
    const captionX = extractFeatureVector({ axis: ExperimentAxis.CAPTION, tone: "curious", targetMetric: "conversions" });
    expect(captionX[5]).toBe(0.75); // CAPTION
    expect(captionX[6]).toBe(0.66); // curious
    expect(captionX[7]).toBe(0.40); // conversions

    const ctaX = extractFeatureVector({ axis: ExperimentAxis.CTA, tone: "urgent", targetMetric: "dwell" });
    expect(ctaX[5]).toBe(0.50); // CTA
    expect(ctaX[6]).toBe(0.33); // urgent
    expect(ctaX[7]).toBe(0.15); // dwell

    const schedX = extractFeatureVector({ axis: ExperimentAxis.SCHEDULE, tone: "bold", targetMetric: "ctr" });
    expect(schedX[5]).toBe(0.25); // SCHEDULE
  });

  it("calculates CTR, conversion rate, normalized dwell, and volume correctly", () => {
    const x = extractFeatureVector({
      impressions: 1000,
      clicks: 200,
      conversions: 50,
      dwellMs: 3000000, // 3000s -> 50 min dwell total -> 3s / impression average -> 3000ms per impression -> 3000/60000 = 0.05
      axis: ExperimentAxis.HOOK,
    });

    expect(x[1]).toBeCloseTo(0.20, 2); // 200 / 1000
    expect(x[2]).toBeCloseTo(0.05, 2); // 50 / 1000
    expect(x[3]).toBeCloseTo(0.05, 2); // 3000ms / 60000ms = 0.05
    expect(x[4]).toBeCloseTo(Math.log10(1001) / 4.0, 3); // log10(1001)/4
  });

  it("clamps metrics safely to avoid invalid range or divide by zero", () => {
    const x = extractFeatureVector({
      impressions: 0,
      clicks: 50, // impossible clicks without impressions
      conversions: 10,
      dwellMs: -500, // negative dwell
    });

    expect(x[1]).toBe(1.0); // clamped to 1.0
    expect(x[3]).toBe(0.0); // clamped negative to 0.0
  });
});

describe("LinUCB Scoring & Dynamic Confidence Calculation", () => {
  it("calculates UCB score and uncertainty for initial cold start state", () => {
    const state = createInitialBanditState();
    const x = extractFeatureVector({ axis: ExperimentAxis.HOOK, tone: "bold", targetMetric: "ctr" });

    const score = computeLinUCBScore(x, state, ALPHA);
    expect(score.predictedReward).toBe(0);
    expect(score.uncertainty).toBeGreaterThan(0);
    expect(score.ucbScore).toBe(ALPHA * score.uncertainty);

    // Initial cold start uncertainty s_a ≈ 1.789 -> raw confidence ~0.66
    expect(score.confidence).toBeGreaterThanOrEqual(0.50);
    expect(score.confidence).toBeLessThanOrEqual(0.95);
  });

  it("scales confidence monotonically as model uncertainty shrinks with data updates", () => {
    let state = createInitialBanditState();
    const x = extractFeatureVector({ impressions: 10, clicks: 2, conversions: 1, dwellMs: 10000 });

    const coldScore = computeLinUCBScore(x, state);

    // Update matrix A with 100 iterations of observations
    for (let i = 0; i < 100; i++) {
      const outer = outerProduct(x);
      state = {
        A: matrixAdd(state.A, outer),
        b: vectorAdd(state.b, vectorScale(x, 0.8)),
        sampleCount: state.sampleCount + 1,
      };
    }

    const warmScore = computeLinUCBScore(x, state);

    expect(warmScore.uncertainty).toBeLessThan(coldScore.uncertainty);
    expect(warmScore.confidence).toBeGreaterThan(coldScore.confidence);
    expect(warmScore.confidence).toBeCloseTo(0.95, 1);
  });

  it("clamps dynamic confidence strictly between 0.50 and 0.95", () => {
    const state = createInitialBanditState();
    const extremeX = [10, 10, 10, 10, 10, 10, 10, 10]; // large norm -> high variance

    const score = computeLinUCBScore(extremeX, state);
    expect(score.confidence).toBeGreaterThanOrEqual(0.50);
    expect(score.confidence).toBeLessThanOrEqual(0.95);
  });
});

describe("synthesiseVariantPayload", () => {
  it("synthesises HOOK variant payload with LinUCB confidence and ucbScore", () => {
    const baseline = { hook: "Metode Efektif" };
    const res = synthesiseVariantPayload(ExperimentAxis.HOOK, baseline, 0, { tone: "bold", targetMetric: "ctr" });

    expect(res.payload.hook).toContain("Metode Efektif");
    expect(res.explanation).toContain("penekanan nilai");
    expect(res.confidence).toBeGreaterThanOrEqual(0.50);
    expect(res.ucbScore).toBeDefined();
  });

  it("synthesises CAPTION, CTA, and SCHEDULE variants", () => {
    const baseline = { caption: "Penjelasan produk", cta: "Mulai" };

    const capRes = synthesiseVariantPayload(ExperimentAxis.CAPTION, baseline, 1);
    expect(capRes.payload.caption).toBeDefined();

    const ctaRes = synthesiseVariantPayload(ExperimentAxis.CTA, baseline, 1);
    expect(ctaRes.payload.cta).toBeDefined();

    const schedRes = synthesiseVariantPayload(ExperimentAxis.SCHEDULE, baseline, 0);
    expect(schedRes.payload.schedule?.hour).toBe(9);
  });
});

describe("Database Operations & Experiment Flow", () => {
  beforeEach(() => {
    experimentCreateMock.mockReset();
    experimentFindUniqueMock.mockReset();
    experimentFindManyMock.mockReset();
    experimentUpdateMock.mockReset();

    variantCreateMock.mockReset();
    variantFindUniqueMock.mockReset();
    variantUpdateMock.mockReset();

    metricFindFirstMock.mockReset();
    metricCreateMock.mockReset();
    metricUpdateMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("startExperiment creates experiment and baseline variant with banditState", async () => {
    const mockExperiment = {
      id: 101,
      organizationId: "org-1",
      contentId: 50,
      axis: ExperimentAxis.HOOK,
      status: ExperimentStatus.running,
      startAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      variants: [],
    };

    experimentCreateMock.mockResolvedValue(mockExperiment);
    experimentFindUniqueMock.mockResolvedValue({
      ...mockExperiment,
      variants: [
        {
          id: 1001,
          experimentId: 101,
          variantKey: "baseline",
          payload: { hook: "Awal", metadata: { banditState: createInitialBanditState() } },
          aiExplanation: "Baseline konten",
          confidence: 0.66,
          createdAt: new Date(),
          updatedAt: new Date(),
          metrics: [],
        },
      ],
    });

    const summary = await startExperiment({
      organizationId: "org-1",
      contentId: 50,
      axis: ExperimentAxis.HOOK,
      baseline: { hook: "Awal" },
    });

    expect(experimentCreateMock).toHaveBeenCalledTimes(1);
    expect(variantCreateMock).toHaveBeenCalledTimes(1);
    expect(summary.experiment.id).toBe(101);
    expect(summary.variants).toHaveLength(1);
  });

  it("generateVariant creates candidate variant with LinUCB state and dynamic confidence", async () => {
    const mockExperiment = {
      id: 102,
      axis: ExperimentAxis.HOOK,
      winnerVariantId: null,
      variants: [
        {
          id: 2001,
          variantKey: "baseline",
          payload: { hook: "Optimalkan tagihan" },
          metrics: [],
        },
      ],
    };

    experimentFindUniqueMock
      .mockResolvedValueOnce(mockExperiment) // load in generateVariant
      .mockResolvedValueOnce({
        ...mockExperiment,
        variants: [
          mockExperiment.variants[0],
          {
            id: 2002,
            variantKey: "variant-1",
            payload: { hook: "🚀 Optimalkan tagihan", metadata: { tone: "bold", banditState: createInitialBanditState() } },
            aiExplanation: "Disetel dengan sense of urgency",
            confidence: 0.66,
            createdAt: new Date(),
            updatedAt: new Date(),
            metrics: [],
          },
        ],
      });

    variantCreateMock.mockResolvedValue({ id: 2002 });

    const summary = await generateVariant({
      experimentId: 102,
      tone: "bold",
      targetMetric: "ctr",
    });

    expect(variantCreateMock).toHaveBeenCalledTimes(1);
    const createArg = variantCreateMock.mock.calls[0][0];
    expect(createArg.data.confidence).toBeGreaterThanOrEqual(0.50);
    expect(createArg.data.confidence).toBeLessThanOrEqual(0.95);
    expect(summary.variants).toHaveLength(2);
  });

  it("recordVariantPerformance updates metrics, LinUCB matrix A & b, dynamic confidence, and DB", async () => {
    const variantRecord = {
      id: 3001,
      experimentId: 103,
      variantKey: "variant-1",
      payload: {
        hook: "Draft",
        metadata: {
          tone: "bold",
          targetMetric: "ctr",
          banditState: createInitialBanditState(),
        },
      },
      confidence: 0.66,
      experiment: { axis: ExperimentAxis.HOOK },
      metrics: [],
    };

    variantFindUniqueMock.mockResolvedValue(variantRecord);
    metricFindFirstMock.mockResolvedValue(null); // No previous metric
    metricCreateMock.mockResolvedValue({
      id: 1,
      variantId: 3001,
      impressions: 100,
      clicks: 20,
      conversions: 5,
      dwellMs: 60000,
      ctr: 0.20,
    });
    variantUpdateMock.mockResolvedValue({ id: 3001 });

    const result = await recordVariantPerformance({
      variantId: 3001,
      impressions: 100,
      clicks: 20,
      conversions: 5,
      dwellMs: 60000,
    });

    expect(metricCreateMock).toHaveBeenCalledTimes(1);
    expect(variantUpdateMock).toHaveBeenCalledTimes(1);

    const updateArg = variantUpdateMock.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 3001 });
    expect(updateArg.data.confidence).toBeGreaterThan(0.50);

    const updatedPayload = JSON.parse(JSON.stringify(updateArg.data.payload));
    expect(updatedPayload.metadata.banditState.sampleCount).toBe(1);
    expect(updatedPayload.metadata.banditState.A.length).toBe(8);
    expect(updatedPayload.metadata.banditState.b.length).toBe(8);

    expect(result.impressions).toBe(100);
    expect(result.clicks).toBe(20);
    expect(result.conversions).toBe(5);
  });

  it("handles high impressions with 0 conversions safely without division by zero", async () => {
    const variantRecord = {
      id: 3002,
      experimentId: 103,
      variantKey: "variant-2",
      payload: { hook: "Draft 2", metadata: { banditState: createInitialBanditState() } },
      confidence: 0.66,
      experiment: { axis: ExperimentAxis.HOOK },
    };

    variantFindUniqueMock.mockResolvedValue(variantRecord);
    metricFindFirstMock.mockResolvedValue(null);
    metricCreateMock.mockResolvedValue({
      id: 2,
      variantId: 3002,
      impressions: 5000,
      clicks: 150,
      conversions: 0, // 0 conversions
      dwellMs: 120000,
      ctr: 0.03,
    });

    const result = await recordVariantPerformance({
      variantId: 3002,
      impressions: 5000,
      clicks: 150,
      conversions: 0,
      dwellMs: 120000,
    });

    expect(result.conversions).toBe(0);
    expect(result.impressions).toBe(5000);
    expect(variantUpdateMock).toHaveBeenCalledTimes(1);
  });
});
