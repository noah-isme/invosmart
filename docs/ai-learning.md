# InvoSmart AI Learning Loop

## Overview

InvoSmart v1.2 introduces a continuous learning layer that closes the feedback loop between
observability metrics, optimizer recommendations, and admin oversight. The system evaluates
all applied/rejected optimizations, recalibrates confidence scores, and executes safe rollbacks
whenever a regression is detected.

## Pipeline

1. **Metric ingestion** – PostHog and Sentry metrics are collected by `fetchMetrics` and processed by
   `runLearningCycle` to calculate delta LCP, INP, API latency, and error rate.
2. **Evaluation** – Each optimization log updated after the previous evaluation window is assessed.
   The aggregated percent change feeds the success rate, average impact, and confidence weight of
   the related `LearningProfile` record.
3. **Confidence recalibration** – The AI optimizer reuses the stored `confidenceWeight` via
   `applyConfidenceRecalibration`, capping per-iteration shifts to ±10% to preserve stability.
4. **Auto rollback** – When the composite impact drops below the configured threshold (default −5%),
   `processAutoRollback` marks the affected optimizations as rejected, persists rollback metadata,
   and emits a Sentry info log for auditability.
5. **Admin insight** – `/devtools/ai-learning` visualizes success rate trends, confidence history,
   rollback events, and exposes a manual “Re-evaluate” action that forces a new learning cycle.

## Data Model

`LearningProfile` stores aggregated learning context per route:

| Field | Description |
| --- | --- |
| `route` | Route identifier (primary key). |
| `successRate` | Rolling ratio of successful optimizations. |
| `avgImpact` | Average composite performance delta. |
| `confidenceWeight` | Current confidence adjustment applied to new recommendations. |
| `totalEvaluations` | Number of recorded evaluations. |
| `last*` metrics | Snapshot of the most recent LCP, INP, API latency, and error rate. |
| `lastEval` | Timestamp of the latest evaluation run. |

`OptimizationLog` now persists `rollback`, `deltaImpact`, and `evalConfidence` so the dashboard can
render an auditable learning trail.

## Feature Flags

- `ENABLE_AI_OPTIMIZER` – Enables recommendation generation.
- `ENABLE_AI_LEARNING` – Enables the learning cycle, auto rollback, and dashboard visualizations.

Flags can be toggled independently; when learning is disabled, evaluations and confidence
recalibration automatically no-op while the optimizer remains available.
