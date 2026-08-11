# Comprehensive Test Infrastructure & Phase 1 Interface Analysis

## 1. Test Infrastructure Overview

### 1.1 Test Frameworks & Commands
The InvoSmart codebase utilizes two primary testing frameworks and a code quality/graph build pipeline defined in `package.json`:

| Framework / Tool | Command | Scope & Configuration |
|---|---|---|
| **Vitest** (v2.1.8) | `npm run test` | Unit and integration testing (`vitest run`). Configured via `vitest.config.mts` and `vitest.setup.ts`. |
| **Playwright** (v1.49.1) | `npm run test:e2e` | End-to-End browser testing (`playwright test --reporter=list --output=QA-report`). Configured via `playwright.config.ts`. |
| **Next.js Build** | `npm run build` | Full TypeScript compilation and Next.js bundle production. |
| **Graphify Knowledge Graph** | `npx graphify update .` | AST-based codebase knowledge graph maintenance. |

### 1.2 Configuration & Directory Structure
- **Vitest Config (`vitest.config.mts`)**:
  - Environment: `jsdom`
  - Setup Files: `./vitest.setup.ts`
  - Path Alias: `@` mapping to project root `.`.
  - Mocks: Comprehensive unit test mocks for `@prisma/client`, `next-auth`, `bcrypt`, `openai`, `posthog-js`, `posthog-node`, `@sentry/nextjs`, `@sentry/core`, and `reactflow` in `test/mocks/`.
  - Exclusions: `test/e2e/**`, `node_modules/**`, `dist/**`.
- **Playwright Config (`playwright.config.ts`)**:
  - Test Directory: `test/e2e`
  - Target URL: `http://127.0.0.1:3000` (or `PORT` env)
  - Browser: Chromium Desktop
  - WebServer Command: `npm run start` with `timeout: 120_000` ms.
- **Existing Test Directories**:
  - `lib/__tests__/`: Unit tests for core AI engines, orchestrator, priority, loop, scaler, policy, scoring, RUM, and recovery agent (`18 test files`).
  - `app/__tests__/` & `app/api/__tests__/`: API route and UI component tests (`30+ test files`).
  - `test/`: Integration and cross-module tests including `federation-bus.test.ts`, `telemetry.test.ts`, `explain-api.test.ts`, `sentry.test.ts`, `receipts/` tests, and `test/mocks/`.
  - `test/e2e/`: Playwright E2E spec files (`auth.spec.ts`, `invoice-flow.spec.ts`, `qa.e2e.spec.ts`).

---

## 2. Phase 1 Near-Term Feature Exploration & Interfaces

### Feature 1: Contextual Bandit Model Migration
- **Primary Source File**: `lib/ai/content-local-optimizer.ts`
- **Helper Modules**: `lib/ai/scoring.ts`, `lib/stats/ab.ts`
- **Key Functions & Export Signatures**:
  ```typescript
  synthesiseVariantPayload(
    axis: ExperimentAxis,
    baseline: VariantPayload,
    variantIndex: number,
    options?: { tone?: "bold" | "curious" | "urgent"; targetMetric?: "ctr" | "conversions" | "dwell"; globalSignal?: string }
  ): { payload: VariantPayload; explanation: string };

  recordVariantPerformance(params: {
    variantId: number;
    impressions: number;
    clicks: number;
    conversions: number;
    dwellMs: number;
  }): Promise<VariantPerformanceSummary>;

  startExperiment(params: { organizationId?: string; contentId: number; axis: ExperimentAxis; baseline: VariantPayload; status?: ExperimentStatus }): Promise<ExperimentSummary>;
  generateVariant(params: { experimentId: number; tone?: "bold" | "curious" | "urgent"; targetMetric?: "ctr" | "conversions" | "dwell"; globalSignal?: string }): Promise<ExperimentSummary>;
  summariseExperiment(experimentId: number): Promise<ExperimentSummary | null>;
  chooseWinner(params: { experimentId: number; variantId: number }): Promise<ExperimentSummary>;
  computeEngagementScore(performance: VariantPerformance, weights?: EngagementWeights): EngagementScore;
  ```
- **Data Structures**:
  - `VariantPayload`: `{ hook?: string, caption?: string, cta?: string, schedule?: { day: string, hour: number, window?: string, timezone?: string }, metadata?: Record<string, any> }`
  - `EngagementScore`: `{ score: number, ctr: number, conversionRate: number, averageDwellMs: number, weights: EngagementWeights }`
  - Default Engagement Weights: `{ ctr: 0.45, conversions: 0.40, dwell: 0.15 }`
- **Contextual Bandit Requirement (R1)**:
  - Migrate from static heuristic synthesis to LinUCB / Contextual UCB reward scoring incorporating user context features (CTR, conversions, dwell time, baseline metrics) and dynamic confidence bounds.

---

### Feature 2: Real-time Webhook Alerts (Discord & Slack)
- **Primary Target File**: `lib/ai/webhooks.ts`
- **Integrating Module**: `lib/ai/approval-gates.ts`
- **Key Functions & Export Signatures**:
  ```typescript
  // Target in lib/ai/webhooks.ts
  dispatchWebhookAlert(action: AiAutoAction): Promise<{ discordSent: boolean; slackSent: boolean; errors?: string[] }>;
  formatDiscordEmbedPayload(action: AiAutoAction): DiscordEmbedPayload;
  formatSlackBlockKitPayload(action: AiAutoAction): SlackBlockKitPayload;

  // Integrated from lib/ai/approval-gates.ts
  evaluateAutoPublish(params: { organizationId?: string; axis: ExperimentAxis; confidence: number; sampleSize: number; highStakes?: boolean; minSampleSize?: number }): Promise<AutoPublishEvaluation>;
  logAutoAction(params: { organizationId?: string; actionType: AutoActionType; contentId?: number; experimentId?: number; variantId?: number; reason: string; confidence?: number }): Promise<AiAutoAction>;
  markAutoActionReverted(params: { actionId: number; reason?: string }): Promise<AiAutoAction>;
  ```
- **Data Structures & Types**:
  - `AutoActionType`: `'AUTOPUBLISH'`, `'SCHEDULE_UPDATE'`, `'AUTO_REVERT'`, `'AUTO_CTA_TUNE'`
  - `AutoActionStatus`: `'applied'`, `'reverted'`, `'failed'`
  - Environment Variables: `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`
- **Requirements (R2)**:
  - Must format custom Discord Embeds (color-coded by action type, title, fields for confidence, reason, organization) and Slack Block Kit payloads (section blocks, fields, action context).
  - Must handle missing webhook URLs gracefully without crashing.
  - Must capture network HTTP errors (5xx/4xx) gracefully.

---

### Feature 3: Federation Bus Asymmetric Payload Encryption & Signing
- **Primary Source Files**: `lib/federation/bus.ts`, `lib/federation/protocol.ts`
- **Key Functions & Export Signatures**:
  ```typescript
  class FederationBus {
    constructor(options?: FederationBusOptions);
    get isEnabled(): boolean;
    publish<TType extends FederationEventType>(input: FederationEventInput<TType>): Promise<{ event: FederationEvent<TType> | null; deliveries: DeliveryResult[] }>;
    subscribe<TType extends FederationEventType>(type: TType, listener: Listener<TType>): () => void;
    ingest(event: FederationEvent): Promise<boolean>;
    checkConnections(): Promise<FederationEndpointStatus[]>;
    getStatus(): FederationStatusSummary;
  }
  validateFederationEvent<TType extends FederationEventType>(input: FederationEventInput<TType>): PreparedFederationEvent<TType>;
  sanitizeMetadata<T extends Record<string, unknown>>(payload: T): T;
  deriveAggregatedPriorities(snapshots: FederationSnapshot[]): AggregatedPriority[];
  aggregateTrustScores(snapshots: FederationSnapshot[]): TrustScoreAggregateSummary;
  ```
- **Data Structures & Protocol Types**:
  - `FederationEventType`: `'telemetry_sync'`, `'priority_share'`, `'trust_aggregate'`, `'model_update'`
  - `FederationEvent`: Extended to support asymmetric signature (`signature` via RSA/Ed25519 or HMAC fallback), `encryptedPayload`, `encryptedKey`, `iv`, and `keyId` for hybrid payload encryption (AES-256-GCM + asymmetric key exchange).
- **Requirements (R3)**:
  - Upgrade signature generation and verification from basic HMAC to RSA/Ed25519 asymmetric signatures.
  - Implement AES-256-GCM payload encryption for cross-tenant telemetry privacy.
  - Sanitize PII/secrets (`rawEvents`, `pii`, `secrets`, `authToken`, `accessToken`, `session`).

---

### Feature 4: Database & API / System Loop Hardening
- **Primary Source Files**: `prisma/schema.prisma`, `lib/ai/loop.ts`, `lib/ai/orchestrator.ts`, `lib/ai/policy.ts`, `lib/ai/trustScore.ts`
- **Key Functions & Export Signatures**:
  ```typescript
  // Loop (lib/ai/loop.ts)
  runLoop(overrides?: { telemetry?: Partial<LoopTelemetry>; scaling?: Partial<ScalingState>; emitEvent?: boolean }): Promise<LoopRunResult>;
  adaptiveInterval(metrics: Pick<LoopTelemetry, "load" | "trustScore" | "successRate" | "errorRate">, baseInterval?: number): number;
  startAutonomyLoop(): Promise<{ started: boolean; reason?: string }>;
  stopAutonomyLoop(): void;
  getLoopState(): Promise<LoopStateSummary>;

  // Orchestrator (lib/ai/orchestrator.ts)
  dispatchEvent(input: MapEventInput): Promise<MapEvent | null>;
  registerAgent(input: AgentRegistrationInput): AgentRegistration;
  resolveConflict(events: MapEvent[]): MapEvent | null;
  getOrchestratorSnapshot(opts?: { limit?: number }): Promise<OrchestratorSnapshot>;

  // Policy & Governance (lib/ai/policy.ts & lib/ai/trustScore.ts)
  evaluatePolicy(params: { route: string; confidence: number; action: PolicyAction }): PolicyEvaluation;
  recordGovernanceDecision(params: { route: string; evaluation: PolicyEvaluation; recommendationId?: string }): Promise<void>;
  getTrustScore(): Promise<TrustScore>;
  calculateTrustScore(params: { successRate: number; rollbackRate: number; policyViolationRate: number }): number;
  ```
- **Database & Prisma Requirements (R4)**:
  - Single and composite indexes added to Prisma schema:
    - `Invoice`: `@@index([userId])`, `@@index([status])`, `@@index([issuedAt])`
    - `OptimizationLog`: `@@index([route])`, `@@index([status])`, `@@index([createdAt])`
    - `ExplanationLog`: `@@index([recommendationId])`, `@@index([route])`
  - Versioned migration folder structure in `prisma/migrations/`.

---

## 3. Comprehensive Test Specification (Tiers 1-4)

### Tier 1: Feature Coverage (>=5 Test Scenarios per Feature)

#### Feature 1: Contextual Bandit Model
1. **LinUCB Reward Scoring**: Verify upper confidence bound (UCB) calculations correctly weight CTR (0.45), conversions (0.40), and dwell time (0.15).
2. **Dynamic Variant Payload Synthesis**: Verify `synthesiseVariantPayload` produces valid variant payloads across HOOK, CAPTION, CTA, and SCHEDULE axes.
3. **Performance Tracking & Weight Updates**: Verify `recordVariantPerformance` updates impressions, clicks, conversions, dwellMs, CTR, and adjusts bandit priors.
4. **Experiment Lifecycle**: Verify full experiment flow from `startExperiment` -> `generateVariant` -> `recordVariantPerformance` -> `chooseWinner`.
5. **Confidence Growth**: Verify candidate variant confidence grows dynamically with sample size and metric uplift relative to baseline.

#### Feature 2: Discord & Slack Webhooks
1. **Discord Embed Payload Formatting**: Verify `formatDiscordEmbedPayload` produces valid Discord Webhook JSON embeds for `AUTOPUBLISH`, `SCHEDULE_UPDATE`, and `AUTO_REVERT` actions.
2. **Slack Block Kit Formatting**: Verify `formatSlackBlockKitPayload` generates standard Slack blocks with proper text sections and context elements.
3. **Dual Webhook Dispatch**: Verify `dispatchWebhookAlert` executes parallel HTTP POST requests when both `DISCORD_WEBHOOK_URL` and `SLACK_WEBHOOK_URL` are defined.
4. **Quota & Approval Gate Integration**: Verify `evaluateAutoPublish` triggers webhook notifications only when auto-publish action decisions are made.
5. **Revert Notification Dispatch**: Verify `markAutoActionReverted` triggers an `AUTO_REVERT` webhook alert containing the revert reason.

#### Feature 3: Asymmetric Federation Bus
1. **Asymmetric Key Pair Signing & Verification**: Verify `bus.publish` signs payload with RSA/Ed25519 private key and `bus.ingest` verifies with public key.
2. **Hybrid AES-256-GCM Payload Encryption**: Verify event payloads are encrypted prior to delivery and correctly decrypted upon receipt.
3. **Event Subscriptions & Event Types**: Verify subscriber callbacks fire accurately for `telemetry_sync`, `priority_share`, `trust_aggregate`, and `model_update`.
4. **PII Sanitization**: Verify `sanitizeMetadata` strips sensitive keys (`secrets`, `authToken`, `pii`, `accessToken`) before event transmission.
5. **Multi-Tenant Snapshot Aggregation**: Verify `deriveAggregatedPriorities` and `aggregateTrustScores` correctly aggregate cross-tenant snapshots.

#### Feature 4: DB & System Loop
1. **Prisma Indexing & Migration Integrity**: Verify Prisma client queries efficiently filter using newly added composite indexes on `Invoice`, `OptimizationLog`, and `ExplanationLog`.
2. **Autonomous Loop Execution**: Verify `runLoop` collects telemetry, adjusts concurrency/interval via `evaluateScaling`, and executes recovery sweeps.
3. **Adaptive Interval Calculation**: Verify `adaptiveInterval` scales delay dynamically based on system load, trust score, success rate, and error rate.
4. **Governance Policy Resolution**: Verify `evaluatePolicy` enforces strict constraints on critical route prefixes (`/auth`, `/admin`, `/app`).
5. **Trust Score Metric Calculation**: Verify `calculateTrustScore` computes weighted scores (50% success, 30% non-rollback, 20% policy compliance).

---

### Tier 2: Boundary & Corner Cases

1. **Empty / Invalid Inputs**:
   - Empty variant payload input to `synthesiseVariantPayload`.
   - Zero impressions (`impressions = 0`) in `recordVariantPerformance` (verify zero division safety).
   - Empty endpoints array or blank secret in `FederationBus`.
2. **Missing Environment Variables**:
   - `DISCORD_WEBHOOK_URL` or `SLACK_WEBHOOK_URL` missing -> ensure `dispatchWebhookAlert` degrades gracefully without throwing.
   - `ENABLE_AI_FEDERATION=false` or missing `FEDERATION_TOKEN_SECRET` -> bus returns disabled status.
   - `ENABLE_AI_AUTONOMY=false` -> `runLoop` returns disabled result cleanly.
3. **Invalid Cryptographic Signatures & Keys**:
   - Malformed/tampered signature in `bus.ingest` -> expect explicit rejection error.
   - Mismatched tenant public key -> verification fails safely.
4. **Network Failures & Timeouts**:
   - Mocked fetch throwing `FetchError` or HTTP 500/404 on Webhook URLs or Federation endpoints -> ensure non-blocking retry/fallback.
5. **Out-of-Bound Values**:
   - Confidence score < 0 or > 1.0 -> Zod schema validation error handling.
   - Extreme latency or negative error rates in telemetry -> clamped safely between [0, 1].

---

### Tier 3: Cross-Feature Combinations

1. **Auto-Action -> Webhook Alert + DB Log + Telemetry**:
   - When `evaluateAutoPublish` succeeds for a variant, `logAutoAction` persists `AiAutoAction`, `dispatchWebhookAlert` sends Discord/Slack notifications, and `runLoop` telemetry records the auto-action.
2. **Governance Block -> Recovery Sweep + Federation Share**:
   - High error rate triggers policy `BLOCKED` status, causing `RecoveryAgent` to execute rollback, which updates `TrustScore`, emitting an `insight_report` event and sharing updated priorities via `FederationBus.publish`.
3. **Multi-Tenant Federation Sync -> Local Bandit Weight Adaptation**:
   - `FederationBus` receives `priority_share` from remote tenants -> `deriveAggregatedPriorities` updates local `AgentPriority` table -> `synthesiseVariantPayload` incorporates global content signals.

---

### Tier 4: Real-World Application Scenarios (E2E Integration)

1. **Complete Autonomous Optimization Cycle**:
   - User creates invoice content -> `startExperiment` creates baseline -> `generateVariant` uses Contextual Bandit -> impressions/clicks logged via `recordVariantPerformance` -> threshold met -> `evaluateAutoPublish` triggers auto-publish -> `dispatchWebhookAlert` notifies Discord/Slack -> `runLoop` sweeps telemetry.
2. **E2E Financial & Recovery Flow (Playwright + AI Loop)**:
   - Playwright test registers user, generates invoice, simulates LCP/INP performance regression on `/app/invoices` -> `runLoop` detects regression -> `RecoveryAgent` triggers rollback -> verification confirms zero impact on invoice total balances and payment receipts (`Payment` & `Receipt` records remain 100% consistent).
