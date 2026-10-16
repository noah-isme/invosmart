# 13. LinUCB Contextual Bandit for Content Variant Scoring

## Status
Accepted (2026-10-16, recorded retroactively). Supersedes [ADR 006](006-thompson-sampling-ab-testing.md) for content variant scoring.

## Context
ADR 006 chose an engagement score inspired by Thompson Sampling. Phase 1 (2026-08-11) replaced it with a contextual bandit, so that variant scores account for experiment context (axis, target metric, baseline and global signals), not just raw engagement.

## Decision
- **Variant scoring**: content variants are scored with **LinUCB** (`computeLinUCBScore`, `lib/ai/content-local-optimizer.ts:345`). The score uses an 8-dimension feature vector (`extractFeatureVector`) and a per-experiment bandit state (`A` matrix, `b` vector) that is updated by `recordVariantPerformance`.
- **Reward**: the reward is a weighted engagement score of CTR, conversions and dwell time.
- **Choosing a winner**: winners are set explicitly through `chooseWinner`, which only `POST /api/opt/choose-winner` calls. The bandit score and confidence are inputs to that decision; the bandit does not pick the winner by itself.
- **Experiment readouts**: these use Bayesian Beta-Binomial statistics (`lib/ai/bayesian-ab.ts`: posterior, P(B>A), expected loss, credible intervals), shown in `app/app/admin/experiments/[id]`. Frequentist uplift and p-values come from `lib/stats/ab.ts`.

## Consequences
### Positive
*   **Context-aware**: exploration and exploitation account for experiment context.
*   **Interpretable**: the uncertainty term is explicit, which drives the confidence shown to approvers.

### Negative / Trade-offs
*   **More complex**: matrix inversion and per-experiment state are harder to debug than a Beta-sampling bandit.
*   **Two statistical views**: the LinUCB score and the Bayesian readout can disagree, and readers must know which one drives a decision.
