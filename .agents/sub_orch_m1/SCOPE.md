# Scope: Milestone 1 — Contextual Bandit Model Migration

## Architecture
- **Target Module**: `lib/ai/content-local-optimizer.ts`
- **Goal**: Replace static modulo/template heuristic bandit scoring with LinUCB / Contextual UCB reward scoring, dynamic confidence estimation based on model uncertainty bounds, and adaptive prior weight updates upon variant performance recording.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Contextual Bandit Scoring & Selection | LinUCB / Contextual UCB reward scoring & dynamic confidence calculation in content-local-optimizer.ts | M1 | ORIGINAL_REQUEST.md & ROADMAP.md |

## Sub-Milestone Iteration Loop
| # | Iteration | Task | Status |
|---|-----------|------|--------|
| 1 | Iteration 1 | Explorer planning -> Worker implementation & tests -> 2 Reviewers + 2 Challengers + Auditor verification -> Gate check | IN_PROGRESS |

## Interface Contracts

### M1 ↔ AI Engine
- `synthesiseVariantPayload(variantKey: string, experiment: ContentExperiment, globalSignal?: GlobalContentSignal)`:
  - Must return variant payload, contextual bandit confidence score (derived dynamically from LinUCB / UCB uncertainty/variance), and AI explanation.
- `recordVariantPerformance(variantId: string, performance: VariantPerformance)`:
  - Must update variant metrics (`impressions`, `clicks`, `conversions`, `dwellMs`, `ctr`) and recalculate contextual bandit prior weights / reward bounds.

## Code Layout
- `lib/ai/content-local-optimizer.ts`: Core contextual bandit optimizer (owned exclusively by M1).
- `lib/__tests__/content-local-optimizer.test.ts` (or `lib/__tests__/optimizer.test.ts`): Unit test suite for contextual bandit model.
