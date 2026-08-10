# E2E Test Infra: InvoSmart Phase 1 Near-Term Priority Implementation

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial + Real-World Workload Testing across 4 Tiers.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|---------------------|:------:|:------:|:------:|:------:|
| 1 | Contextual Bandit Model (R1) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | Real-time Webhook Alerts (R2) | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 3 | Asymmetric Federation Bus Encryption (R3) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 4 | Database & System Loop Verification (R4) | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test runner: Vitest (`npm run test`) for unit/integration/E2E assertion suites; Playwright (`npm run test:e2e`) for E2E browser flows.
- Invocation: `npx vitest run test/e2e/` or `npm run test`.
- Directory layout:
  - `test/e2e/tier1-feature-coverage.test.ts` (Tier 1: Feature Coverage)
  - `test/e2e/tier2-boundary-corner.test.ts` (Tier 2: Boundary & Corner Cases)
  - `test/e2e/tier3-cross-feature.test.ts` (Tier 3: Cross-Feature Interactions)
  - `test/e2e/tier4-realworld-scenarios.test.ts` (Tier 4: E2E Application Scenarios)

## Tier Breakdown & Test Cases

### Tier 1: Feature Coverage (>=5 test cases per feature)
#### Feature 1: Contextual Bandit Model (R1)
- `T1.1.1`: LinUCB reward scoring calculation with weighted CTR (0.45), conversions (0.40), dwell time (0.15).
- `T1.1.2`: Dynamic variant synthesis across HOOK, CAPTION, CTA, and SCHEDULE axes.
- `T1.1.3`: Variant performance recording and dynamic weight updates.
- `T1.1.4`: Complete experiment lifecycle (start -> generate -> record -> choose winner).
- `T1.1.5`: Dynamic confidence interval growth over increasing sample size.

#### Feature 2: Discord & Slack Webhooks (R2)
- `T1.2.1`: Discord Embed payload formatting for AUTOPUBLISH, SCHEDULE_UPDATE, and AUTO_REVERT actions.
- `T1.2.2`: Slack Block Kit payload formatting with section blocks and fields.
- `T1.2.3`: Dual webhook alert dispatch to DISCORD_WEBHOOK_URL and SLACK_WEBHOOK_URL.
- `T1.2.4`: Approval gate auto-publish evaluation triggering webhook alerts.
- `T1.2.5`: Revert action notification dispatch via markAutoActionReverted.

#### Feature 3: Asymmetric Federation Bus (R3)
- `T1.3.1`: RSA/Ed25519 asymmetric signature generation and verification.
- `T1.3.2`: Hybrid AES-256-GCM payload encryption and decryption.
- `T1.3.3`: Event pub/sub handling for telemetry_sync, priority_share, trust_aggregate, and model_update.
- `T1.3.4`: PII and secret sanitization via sanitizeMetadata.
- `T1.3.5`: Multi-tenant priority derivation and trust score aggregation.

#### Feature 4: DB & System Loop Verification (R4)
- `T1.4.1`: Prisma composite index query verification on Invoice, OptimizationLog, and ExplanationLog.
- `T1.4.2`: Autonomous loop execution, telemetry ingestion, and scaling evaluation.
- `T1.4.3`: Dynamic adaptive interval scaling based on system load and error rates.
- `T1.4.4`: Governance policy evaluation and critical route protection.
- `T1.4.5`: Composite trust score calculation (50% success, 30% rollback, 20% policy compliance).

### Tier 2: Boundary & Corner Cases (>=5 test cases per feature)
#### Feature 1: Contextual Bandit Model
- `T2.1.1`: Empty variant payload handling in synthesiseVariantPayload.
- `T2.1.2`: Zero impressions / cold start handling in recordVariantPerformance (zero-division guard).
- `T2.1.3`: Out-of-bounds performance weights and metric values.
- `T2.1.4`: Unknown/invalid experiment axis fallback.
- `T2.1.5`: Extreme dwell time inputs (0ms and negative values).

#### Feature 2: Webhook Alerts
- `T2.2.1`: Graceful degradation when DISCORD_WEBHOOK_URL and SLACK_WEBHOOK_URL are undefined.
- `T2.2.2`: Handling HTTP network failures (500 Server Error) during webhook dispatch.
- `T2.2.3`: Handling webhook timeout errors without blocking auto-action completion.
- `T2.2.4`: Malformed/empty action payload handling in payload formatters.
- `T2.2.5`: Partial webhook dispatch (one URL defined, one missing).

#### Feature 3: Asymmetric Federation Bus
- `T2.3.1`: Ingesting events with corrupted/tampered cryptographic signatures (explicit rejection).
- `T2.3.2`: Ingesting encrypted payloads with invalid AES keys or corrupted initialization vectors (IV).
- `T2.3.3`: Disabled federation bus state handling (ENABLE_AI_FEDERATION=false).
- `T2.3.4`: Empty metadata object sanitization handling.
- `T2.3.5`: Ingesting empty or unauthenticated federation snapshot arrays.

#### Feature 4: DB & System Loop
- `T2.4.1`: Disabled autonomy loop state (ENABLE_AI_AUTONOMY=false).
- `T2.4.2`: High telemetry error rate (>15%) triggering immediate recovery sweep.
- `T2.4.3`: Policy evaluation with undefined route or negative confidence scores.
- `T2.4.4`: Trust score calculation with 100% policy violation rate.
- `T2.4.5`: Concurrency scaling limits under extreme backlog load.

### Tier 3: Cross-Feature Combinations
- `T3.1`: Auto-Publish Action -> Webhook Dispatch + DB Log + Autonomous Loop Telemetry Update.
- `T3.2`: Policy Violation & Error Spike -> Recovery Sweep Rollback -> Trust Score Update -> Federation Priority Share Event.
- `T3.3`: Multi-Tenant Federation Sync -> Aggregated Agent Priority Update -> Contextual Bandit Variant Selection Adjustment.

### Tier 4: Real-World Application Scenarios
- `T4.1`: Complete End-to-End Autonomous Optimization Flow (User Invoice Creation -> Contextual Bandit Variant Generation -> Analytics Ingestion -> Auto-Publish Gate -> Discord/Slack Webhook Alert -> Loop Telemetry Update).
- `T4.2`: End-to-End Invoice Financial Consistency & Recovery Audit (Simulated Performance Regression during Invoice Processing -> Automatic AI Rollback -> Complete Balance & Payment Receipt Audit Verification).

## Coverage Thresholds
- Tier 1: 5 test cases per feature (20 total minimum)
- Tier 2: 5 test cases per feature (20 total minimum)
- Tier 3: Pairwise cross-feature interaction scenarios (3 scenarios minimum)
- Tier 4: End-to-end application scenarios (2 scenarios minimum)
- Total Minimum Test Scenarios: 45 test cases
