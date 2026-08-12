/**
 * Bayesian A/B Statistical Significance Engine
 * Beta-Binomial Conjugate Posterior Analysis
 */

export interface BetaPrior {
  alpha: number;
  beta: number;
}

export interface VariantSample {
  id?: string | number;
  name?: string;
  impressions: number;
  conversions: number;
}

export interface VariantBayesianStats {
  id?: string | number;
  name?: string;
  impressions: number;
  conversions: number;
  conversionRate: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  mean: number;
  variance: number;
  credibleInterval95: [number, number];
  probBeatsBaseline: number;
  expectedLossVsBaseline: number;
  probIsBest: number;
}

export interface BayesianABResult {
  variants: VariantBayesianStats[];
  baselineId?: string | number;
  winningVariantId?: string | number;
  probBBeatsA?: number; // For 2-variant experiment: P(B > A)
  expectedLossA?: number; // Expected loss if A is chosen
  expectedLossB?: number; // Expected loss if B is chosen
  isStatisticallySignificant: boolean;
  recommendedAction: 'continue' | 'declare_winner' | 'inconclusive';
  summary: string;
}

export interface CalculationOptions {
  prior?: BetaPrior;
  samples?: number; // Number of Monte Carlo draws (default: 50,000)
  seed?: number; // Optional seed for deterministic testing
  significanceThreshold?: number; // Default 0.95 (95%)
  lossThreshold?: number; // Default 0.001
}

// Default uninformative uniform prior Beta(1, 1)
export const DEFAULT_PRIOR: BetaPrior = { alpha: 1, beta: 1 };

// ============================================================================
// Special Mathematical Functions
// ============================================================================

/**
 * Natural log of Gamma function using Lanczos approximation (g=7, N=9)
 */
export function logGamma(z: number): number {
  if (z <= 0) return NaN;
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  z -= 1;
  let x = p[0];
  for (let i = 1; i < p.length; i++) {
    x += p[i] / (z + i);
  }
  const t = z + 7 + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Natural log of Beta function ln B(a, b) = ln Gamma(a) + ln Gamma(b) - ln Gamma(a + b)
 */
export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/**
 * Beta probability density function (PDF)
 */
export function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const logPdf = (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta(a, b);
  return Math.exp(logPdf);
}

/**
 * Incomplete Beta Function (Regularized Beta CDF Ix(a, b))
 * Uses continued fraction representation with symmetry transformation.
 */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Symmetry transformation
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - betaCdf(1 - x, b, a);
  }

  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b)) / a;

  const maxIter = 200;
  const eps = 1e-14;
  const tiny = 1e-30;

  const getD = (m: number): number => {
    if (m % 2 === 0) {
      const k = m / 2;
      return (k * (b - k) * x) / ((a + 2 * k - 1) * (a + 2 * k));
    } else {
      const k = (m - 1) / 2;
      return -((a + k) * (a + b + k) * x) / ((a + 2 * k) * (a + 2 * k + 1));
    }
  };

  let c = 1.0;
  let d = 1.0 / (1.0 + getD(1));
  if (Math.abs(d) < tiny) d = tiny;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;

    const d2m = getD(m2);
    d = 1.0 + d2m * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + d2m / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    h *= d * c;

    const d2m1 = getD(m2 + 1);
    d = 1.0 + d2m1 * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + d2m1 / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1.0) < eps) break;
  }

  return Math.min(1.0, Math.max(0.0, front * h));
}

/**
 * Inverse Beta CDF (Beta Quantile function)
 * Solves Ix(a, b) = p for x using Bisection and Newton-Raphson
 */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;

  // Bisection initialization
  let low = 0;
  let high = 1;
  let x = a / (a + b); // Initial guess: mean

  for (let iter = 0; iter < 40; iter++) {
    const cdf = betaCdf(x, a, b);
    const err = cdf - p;

    if (Math.abs(err) < 1e-10) break;

    if (err > 0) {
      high = x;
    } else {
      low = x;
    }

    const pdf = betaPdf(x, a, b);
    if (pdf > 1e-12) {
      const nextX = x - err / pdf;
      if (nextX > low && nextX < high) {
        x = nextX;
        continue;
      }
    }

    x = 0.5 * (low + high);
  }

  return x;
}

// ============================================================================
// Random Number Generator & Samplers
// ============================================================================

function createRng(seed?: number): () => number {
  if (seed === undefined) {
    return Math.random;
  }
  // Simple Mulberry32 PRNG
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Marsaglia and Tsang method for Gamma random variable sample G(alpha, 1)
 */
function sampleGamma(alpha: number, rng: () => number): number {
  if (alpha < 1) {
    return sampleGamma(1 + alpha, rng) * Math.pow(rng() || 1e-10, 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    const u1 = rng() || 1e-10;
    const u2 = rng() || 1e-10;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = 1 + c * z;
    if (v <= 0) continue;
    const v3 = v * v * v;
    const u = rng() || 1e-10;
    if (u < 1 - 0.0331 * z * z * z * z) {
      return d * v3;
    }
    if (Math.log(u) < 0.5 * z * z + d * (1 - v3 + Math.log(v3))) {
      return d * v3;
    }
  }
}

/**
 * Sample Beta(alpha, beta) random variable
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const gA = sampleGamma(alpha, rng);
  const gB = sampleGamma(beta, rng);
  if (gA + gB === 0) return 0.5;
  return gA / (gA + gB);
}

// ============================================================================
// Core Posterior & Bayesian Analysis Logic
// ============================================================================

/**
 * Compute conjugate posterior Beta(alpha, beta) parameters and stats for a single variant.
 */
export function calculatePosterior(
  impressions: number,
  conversions: number,
  prior: BetaPrior = DEFAULT_PRIOR
): {
  alpha: number;
  beta: number;
  mean: number;
  variance: number;
  conversionRate: number;
} {
  const safeImpressions = Math.max(0, Math.round(impressions));
  const safeConversions = Math.min(safeImpressions, Math.max(0, Math.round(conversions)));

  const alpha = prior.alpha + safeConversions;
  const beta = prior.beta + (safeImpressions - safeConversions);

  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
  const conversionRate = safeImpressions > 0 ? safeConversions / safeImpressions : mean;

  return {
    alpha,
    beta,
    mean,
    variance,
    conversionRate,
  };
}

/**
 * Calculate 95% Credible Interval [lower, upper] for Beta(alpha, beta)
 */
export function calculateCredibleInterval(
  alpha: number,
  beta: number,
  confidenceLevel = 0.95
): [number, number] {
  const alphaTail = (1 - confidenceLevel) / 2;
  const lower = betaQuantile(alphaTail, alpha, beta);
  const upper = betaQuantile(1 - alphaTail, alpha, beta);
  return [lower, upper];
}

/**
 * Calculate numerical exact / Simpson quadrature P(B > A)
 */
export function calculateProbBBeatsA(
  sampleA: VariantSample,
  sampleB: VariantSample,
  prior: BetaPrior = DEFAULT_PRIOR
): number {
  const postA = calculatePosterior(sampleA.impressions, sampleA.conversions, prior);
  const postB = calculatePosterior(sampleB.impressions, sampleB.conversions, prior);

  // Numerical Simpson integration of betaCdf(x, postA) * betaPdf(x, postB) over [0, 1]
  const N = 500;
  const h = 1 / N;
  let sum = betaCdf(0, postA.alpha, postA.beta) * betaPdf(0, postB.alpha, postB.beta) +
            betaCdf(1, postA.alpha, postA.beta) * betaPdf(1, postB.alpha, postB.beta);

  for (let i = 1; i < N; i++) {
    const x = i * h;
    const val = betaCdf(x, postA.alpha, postA.beta) * betaPdf(x, postB.alpha, postB.beta);
    sum += (i % 2 === 0 ? 2 : 4) * val;
  }

  const result = (h / 3) * sum;
  return Math.min(1.0, Math.max(0.0, result));
}

/**
 * Calculate Expected Loss for Choosing A over B and B over A
 */
export function calculateExpectedLoss(
  sampleA: VariantSample,
  sampleB: VariantSample,
  prior: BetaPrior = DEFAULT_PRIOR,
  options?: { samples?: number; seed?: number }
): { expectedLossA: number; expectedLossB: number; probBBeatsA: number } {
  const postA = calculatePosterior(sampleA.impressions, sampleA.conversions, prior);
  const postB = calculatePosterior(sampleB.impressions, sampleB.conversions, prior);

  const numDraws = options?.samples ?? 50000;
  const rng = createRng(options?.seed);

  let lossA = 0;
  let lossB = 0;
  let countBBeatsA = 0;

  for (let i = 0; i < numDraws; i++) {
    const rateA = sampleBeta(postA.alpha, postA.beta, rng);
    const rateB = sampleBeta(postB.alpha, postB.beta, rng);

    if (rateB > rateA) {
      countBBeatsA++;
      lossA += rateB - rateA; // Loss of choosing A when B was better
    } else {
      lossB += rateA - rateB; // Loss of choosing B when A was better
    }
  }

  return {
    expectedLossA: lossA / numDraws,
    expectedLossB: lossB / numDraws,
    probBBeatsA: countBBeatsA / numDraws,
  };
}

/**
 * Compute full Bayesian A/B experiment results across variants
 */
export function computeBayesianABStats(
  variants: VariantSample[],
  options?: CalculationOptions
): BayesianABResult {
  if (!variants || variants.length === 0) {
    return {
      variants: [],
      isStatisticallySignificant: false,
      recommendedAction: 'inconclusive',
      summary: 'Tidak ada data varian untuk dianalisis.',
    };
  }

  const prior = options?.prior ?? DEFAULT_PRIOR;
  const numSamples = options?.samples ?? 50000;
  const rng = createRng(options?.seed);

  const baselineIndex = 0;
  const baselineSample = variants[baselineIndex];
  const baselineId = baselineSample.id ?? 'baseline';

  // 1. Compute individual posteriors and credible intervals
  const posteriors = variants.map((v) => calculatePosterior(v.impressions, v.conversions, prior));
  const credibleIntervals = posteriors.map((p) => calculateCredibleInterval(p.alpha, p.beta, 0.95));

  // 2. Monte Carlo Simulation for joint probabilities and expected losses
  const winCounts = new Array(variants.length).fill(0);
  const beatsBaselineCounts = new Array(variants.length).fill(0);
  const totalLossVsBaseline = new Array(variants.length).fill(0);

  for (let s = 0; s < numSamples; s++) {
    const drawnRates = posteriors.map((p) => sampleBeta(p.alpha, p.beta, rng));
    const baselineRate = drawnRates[baselineIndex];

    let maxRate = -1;
    let winnerIdx = 0;

    for (let i = 0; i < variants.length; i++) {
      const rate = drawnRates[i];
      if (rate > maxRate) {
        maxRate = rate;
        winnerIdx = i;
      }

      if (i !== baselineIndex) {
        if (rate > baselineRate) {
          beatsBaselineCounts[i]++;
        }
        totalLossVsBaseline[i] += Math.max(0, baselineRate - rate);
      }
    }

    winCounts[winnerIdx]++;
  }

  // Calculate baseline's loss vs each variant
  const probIsBest = winCounts.map((count) => count / numSamples);

  let bestVariantIdx = 0;
  let maxProbBest = -1;

  for (let i = 0; i < variants.length; i++) {
    if (probIsBest[i] > maxProbBest) {
      maxProbBest = probIsBest[i];
      bestVariantIdx = i;
    }
  }

  const winningVariant = variants[bestVariantIdx];
  const winningVariantId = winningVariant.id ?? `variant-${bestVariantIdx}`;

  // 3. Assemble VariantBayesianStats
  const variantStats: VariantBayesianStats[] = variants.map((v, i) => {
    const post = posteriors[i];
    const ci = credibleIntervals[i];
    const probBeats = i === baselineIndex ? 0.5 : beatsBaselineCounts[i] / numSamples;
    const lossVsBaseline = i === baselineIndex ? 0 : totalLossVsBaseline[i] / numSamples;

    return {
      id: v.id ?? `variant-${i}`,
      name: v.name ?? (i === 0 ? 'Baseline (Control)' : `Variant ${i}`),
      impressions: v.impressions,
      conversions: v.conversions,
      conversionRate: post.conversionRate,
      posteriorAlpha: post.alpha,
      posteriorBeta: post.beta,
      mean: post.mean,
      variance: post.variance,
      credibleInterval95: ci,
      probBeatsBaseline: probBeats,
      expectedLossVsBaseline: lossVsBaseline,
      probIsBest: probIsBest[i],
    };
  });

  // 4. Two-variant specific metrics (A vs B)
  let probBBeatsA: number | undefined;
  let expectedLossA: number | undefined;
  let expectedLossB: number | undefined;

  if (variants.length >= 2) {
    const lossResult = calculateExpectedLoss(variants[0], variants[1], prior, {
      samples: numSamples,
      seed: options?.seed,
    });
    probBBeatsA = lossResult.probBBeatsA;
    expectedLossA = lossResult.expectedLossA;
    expectedLossB = lossResult.expectedLossB;
  }

  // 5. Significance and recommendation
  const significanceThreshold = options?.significanceThreshold ?? 0.95;
  const lossThreshold = options?.lossThreshold ?? 0.001;

  const isStatisticallySignificant =
    variants.length >= 2
      ? (probBBeatsA !== undefined && (probBBeatsA >= significanceThreshold || probBBeatsA <= 1 - significanceThreshold)) ||
        (expectedLossB !== undefined && expectedLossB <= lossThreshold && probBBeatsA! >= 0.90)
      : false;

  let recommendedAction: 'continue' | 'declare_winner' | 'inconclusive' = 'continue';
  let summary = '';

  const totalImpressions = variants.reduce((acc, v) => acc + v.impressions, 0);

  if (totalImpressions < 50) {
    recommendedAction = 'continue';
    summary = 'Jumlah sampel masih terlalu kecil (< 50 impressions). Lanjutkan pengumpulan data.';
  } else if (isStatisticallySignificant) {
    recommendedAction = 'declare_winner';
    summary = `Varian "${winningVariant.name ?? winningVariant.id}" secara signifikan unggul dengan probabilitas ${((maxProbBest) * 100).toFixed(1)}%.`;
  } else {
    recommendedAction = 'inconclusive';
    summary = `Belum ada varian yang mencapai signifikansi statistik (95%). Probabilitas tertinggi: ${(maxProbBest * 100).toFixed(1)}%.`;
  }

  return {
    variants: variantStats,
    baselineId,
    winningVariantId,
    probBBeatsA,
    expectedLossA,
    expectedLossB,
    isStatisticallySignificant,
    recommendedAction,
    summary,
  };
}
