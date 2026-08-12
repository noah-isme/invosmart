import { describe, expect, it } from 'vitest';
import {
  betaCdf,
  betaPdf,
  betaQuantile,
  calculateCredibleInterval,
  calculateExpectedLoss,
  calculatePosterior,
  calculateProbBBeatsA,
  computeBayesianABStats,
  logBeta,
  logGamma,
  sampleBeta,
} from '../ai/bayesian-ab';

describe('Bayesian A/B Statistical Significance Engine', () => {
  describe('Special Math Functions', () => {
    it('computes logGamma accurately', () => {
      // Gamma(1) = 1 => logGamma(1) = 0
      expect(logGamma(1)).toBeCloseTo(0, 5);
      // Gamma(2) = 1 => logGamma(2) = 0
      expect(logGamma(2)).toBeCloseTo(0, 5);
      // Gamma(5) = 24 => logGamma(5) = ln(24) ~ 3.17805
      expect(logGamma(5)).toBeCloseTo(Math.log(24), 5);
    });

    it('computes logBeta accurately', () => {
      // B(1, 1) = 1 => logBeta(1, 1) = 0
      expect(logBeta(1, 1)).toBeCloseTo(0, 5);
      // B(2, 2) = 1/6 => logBeta(2, 2) = -ln(6) ~ -1.79176
      expect(logBeta(2, 2)).toBeCloseTo(-Math.log(6), 5);
    });

    it('computes Beta PDF and CDF', () => {
      // Beta(1, 1) is uniform distribution PDF = 1 on [0, 1]
      expect(betaPdf(0.5, 1, 1)).toBeCloseTo(1, 5);
      expect(betaCdf(0.5, 1, 1)).toBeCloseTo(0.5, 5);
      expect(betaCdf(0.25, 1, 1)).toBeCloseTo(0.25, 5);

      // Beta(2, 2) CDF at 0.5 is 0.5 (symmetric)
      expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 5);
    });

    it('computes Beta Quantile (inverse CDF)', () => {
      // Beta(1, 1) quantile(0.5) = 0.5
      expect(betaQuantile(0.5, 1, 1)).toBeCloseTo(0.5, 4);
      // Beta(1, 1) quantile(0.025) = 0.025
      expect(betaQuantile(0.025, 1, 1)).toBeCloseTo(0.025, 4);
      // Beta(1, 1) quantile(0.975) = 0.975
      expect(betaQuantile(0.975, 1, 1)).toBeCloseTo(0.975, 4);
    });
  });

  describe('Conjugate Posterior Calculations', () => {
    it('calculates posterior parameters with default uniform prior Beta(1,1)', () => {
      // 1000 impressions, 100 conversions
      const post = calculatePosterior(1000, 100);
      expect(post.alpha).toBe(101); // 1 + 100
      expect(post.beta).toBe(901); // 1 + 900
      expect(post.conversionRate).toBeCloseTo(0.10, 4);
      expect(post.mean).toBeCloseTo(101 / 1002, 4); // ~0.1008
      expect(post.variance).toBeGreaterThan(0);
    });

    it('handles 0 impressions and 0 conversions gracefully', () => {
      const post = calculatePosterior(0, 0);
      expect(post.alpha).toBe(1);
      expect(post.beta).toBe(1);
      expect(post.mean).toBe(0.5);
    });

    it('calculates 95% Credible Interval', () => {
      // 100 conversions out of 1000 impressions
      const post = calculatePosterior(1000, 100);
      const [lower, upper] = calculateCredibleInterval(post.alpha, post.beta, 0.95);

      expect(lower).toBeGreaterThan(0.07);
      expect(lower).toBeLessThan(0.10);
      expect(upper).toBeGreaterThan(0.10);
      expect(upper).toBeLessThan(0.13);
      expect(lower).toBeLessThan(upper);
    });
  });

  describe('P(B > A) and Expected Loss', () => {
    it('returns approximately 0.50 when variant A and B have identical conversion rates', () => {
      const sampleA = { impressions: 1000, conversions: 100 };
      const sampleB = { impressions: 1000, conversions: 100 };

      const probBBeatsA = calculateProbBBeatsA(sampleA, sampleB);
      expect(probBBeatsA).toBeGreaterThan(0.45);
      expect(probBBeatsA).toBeLessThan(0.55);
    });

    it('returns P(B > A) > 0.99 when variant B is clearly superior', () => {
      const sampleA = { impressions: 1000, conversions: 100 }; // 10%
      const sampleB = { impressions: 1000, conversions: 200 }; // 20%

      const probBBeatsA = calculateProbBBeatsA(sampleA, sampleB);
      expect(probBBeatsA).toBeGreaterThan(0.99);
    });

    it('returns P(B > A) < 0.01 when variant B is clearly inferior', () => {
      const sampleA = { impressions: 1000, conversions: 200 }; // 20%
      const sampleB = { impressions: 1000, conversions: 100 }; // 10%

      const probBBeatsA = calculateProbBBeatsA(sampleA, sampleB);
      expect(probBBeatsA).toBeLessThan(0.01);
    });

    it('computes expected loss with deterministic seed', () => {
      const sampleA = { impressions: 1000, conversions: 100 };
      const sampleB = { impressions: 1000, conversions: 150 };

      const lossResult = calculateExpectedLoss(sampleA, sampleB, undefined, { seed: 12345 });
      expect(lossResult.probBBeatsA).toBeGreaterThan(0.95);
      expect(lossResult.expectedLossB).toBeLessThan(0.005); // Choosing B carries very low loss
      expect(lossResult.expectedLossA).toBeGreaterThan(0.03); // Choosing A carries significant loss
    });
  });

  describe('Full Experiment Bayesian A/B Engine', () => {
    it('handles empty variants array gracefully', () => {
      const result = computeBayesianABStats([]);
      expect(result.variants).toHaveLength(0);
      expect(result.isStatisticallySignificant).toBe(false);
      expect(result.recommendedAction).toBe('inconclusive');
    });

    it('computes stats for a 2-variant experiment with clear winner', () => {
      const variants = [
        { id: 'ctrl', name: 'Control A', impressions: 1000, conversions: 100 },
        { id: 'var_b', name: 'Variant B', impressions: 1000, conversions: 180 },
      ];

      const result = computeBayesianABStats(variants, { seed: 42 });

      expect(result.variants).toHaveLength(2);
      expect(result.winningVariantId).toBe('var_b');
      expect(result.probBBeatsA).toBeGreaterThan(0.99);
      expect(result.isStatisticallySignificant).toBe(true);
      expect(result.recommendedAction).toBe('declare_winner');

      const varBStats = result.variants[1];
      expect(varBStats.conversionRate).toBe(0.18);
      expect(varBStats.credibleInterval95[0]).toBeGreaterThan(0.15);
      expect(varBStats.credibleInterval95[1]).toBeLessThan(0.21);
      expect(varBStats.probBeatsBaseline).toBeGreaterThan(0.99);
    });

    it('handles small sample size with continue recommendation', () => {
      const variants = [
        { id: 'ctrl', name: 'Control A', impressions: 10, conversions: 1 },
        { id: 'var_b', name: 'Variant B', impressions: 10, conversions: 3 },
      ];

      const result = computeBayesianABStats(variants, { seed: 42 });
      expect(result.recommendedAction).toBe('continue');
      expect(result.summary).toContain('< 50 impressions');
    });
  });

  describe('Random Sampling Determinism', () => {
    it('generates consistent samples when seed is provided', () => {
      const sample1 = sampleBeta(10, 90, () => 0.5);
      const sample2 = sampleBeta(10, 90, () => 0.5);
      expect(sample1).toBe(sample2);
    });
  });
});
