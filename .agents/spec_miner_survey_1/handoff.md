# Specification Mining Handoff Report: Phase 1 Near-Term Priority Items

**Agent**: `spec_miner_1` (Identity: `teamwork_preview_spec_miner`)  
**Working Directory**: `/home/noah/project/invosmart/.agents/spec_miner_survey_1`  
**Parent**: Project Orchestrator (`be5b1a31-30f8-421b-ac1a-251c1da568ee`)  
**Timestamp**: 2026-08-11  

---

## 1. Observation

Direct code and documentation observations across the InvoSmart workspace:

1. **Specification & Context Files**:
   - `ORIGINAL_REQUEST.md` (lines 10-31): Outlines Phase 1 requirements (R1: Contextual Bandit, R2: Webhook Alerts, R3: Asymmetric Encryption, R4: Database & Verification Hardening) and acceptance criteria (`npm run test`, `npm run build`, `npm run test:e2e`, `graphify update .`).
   - `docs/ROADMAP.md` (lines 73-88): Details Phase 1 priorities including PostgreSQL migration, database migrations, contextual bandit model in `lib/ai/content-local-optimizer.ts`, asymmetric encryption in `lib/federation/bus.ts`, and Discord/Slack webhooks.
   - `AGENTS.md` (lines 1-135): MAP protocol specification, agent priorities (Governance 90, Recovery 85, Optimizer 75, Learning 60, Insight 45, Federation 35), and autonomous loop workflow.

2. **R1: Contextual Bandit Model (`lib/ai/content-local-optimizer.ts`)**:
   - `lib/ai/content-local-optimizer.ts` (lines 149-196): `synthesiseVariantPayload` currently uses modulo indexed static patterns (`HOOK_PATTERNS`, `CAPTION_PATTERNS`, `CTA_LIBRARY`, `SCHEDULE_WINDOWS`). Confidence is a heuristic: `Math.min(0.9, 0.68 + experiment.variants.length * 0.04)`.
   - `lib/ai/scoring.ts` (lines 34-55): `computeEngagementScore` uses weighted formula (`ctr: 0.45`, `conversions: 0.40`, `dwell: 0.15`).
   - `lib/stats/ab.ts`: Contains `calculateUplift` and `estimatePValue` for hypothesis testing.

3. **R2: Real-time Webhook Alerts (`lib/ai/webhooks.ts` & `ai_auto_actions`)**:
   - `lib/ai/approval-gates.ts` (lines 131-166): Logs auto-actions (`logAutoAction`) and marks reverts (`markAutoActionReverted`) in table `db.aiAutoAction`.
   - `lib/ai/webhooks.ts`: Currently missing, needs creation to handle Discord & Slack notification dispatches.

4. **R3: Federation Bus Asymmetric Encryption (`lib/federation/bus.ts`)**:
   - `lib/federation/bus.ts` (lines 100-110, 202-216): Currently uses symmetric HMAC-SHA256 signatures (`createHmac("sha256", secret)`).
   - `lib/federation/protocol.ts` (lines 92-104): `federationEventSchema` specifies `id`, `type`, `tenantId`, `timestamp`, `signature`, and `payload`.

5. **R4: Database & Verification Hardening**:
   - `prisma/schema.prisma` (lines 5-8): Datasource provider configured to `postgres`.
   - `package.json` (lines 9-16): Scripts `test` (`vitest run`), `build` (`next build`), `test:e2e` (`playwright test`).

---

## 2. Logic Chain

1. **R1 Specification Mining Logic**:
   - Current static template rotation in `content-local-optimizer.ts` lacks adaptive learning from contextual feedback.
   - The new Contextual Bandit Model must compute variant rewards using LinUCB / Contextual Thompson Sampling incorporating variant metrics ($CTR$, $conversionRate$, $averageDwell$) and context vectors ($axis$, $tone$, $targetMetric$, global signals).
   - Confidence must be calculated dynamically from bandit model uncertainty bounds rather than a static formula.

2. **R2 Specification Mining Logic**:
   - Admin visibility requires real-time alerts when semi-autonomous decisions take effect (`AUTOPUBLISH`, `SCHEDULE_UPDATE`, `AUTO_REVERT`, `AUTO_CTA_TUNE`).
   - `lib/ai/webhooks.ts` will provide `sendWebhookAlert()`, formatting payload into Discord embeds and Slack blocks, called asynchronously from `logAutoAction` and `markAutoActionReverted`.

3. **R3 Specification Mining Logic**:
   - Cross-tenant federation via shared symmetric HMAC requires key distribution across all external tenants, creating security vulnerabilities.
   - Replacing symmetric HMAC with asymmetric RSA/ECDSA signing (`crypto.sign` / `crypto.verify`) and hybrid payload encryption ensures multi-tenant payload secrecy and non-repudiation.

4. **R4 Specification Mining Logic**:
   - Moving from `db push` to Prisma migrations ensures deterministic, version-controlled database schema changes on PostgreSQL.
   - Verification hardening requires strict local validation (`vitest`, `next build`, `playwright`, `graphify update`).

---

## 3. Features Discovered & Specification Matrix

### Features Discovered
| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| F1 | AI / Bandit | Contextual Bandit Scoring & Variant Selection | Dynamic contextual upper bound scoring for content variants using CTR, conversions, dwell time, and context parameters. | `VariantPerformance`, `axis`, `tone`, `targetMetric`, `globalSignal` | Selected payload, dynamic confidence score, AI explanation | Cold start initializes prior weights + max exploration bonus; invalid payload falls back to baseline | `lib/ai/content-local-optimizer.ts` & `ORIGINAL_REQUEST.md` |
| F2 | Integrations | Discord Webhook Alerts | Dispatch rich embed notifications to Discord webhooks upon `ai_auto_actions` mutation. | `WebhookAlertPayload`, `DISCORD_WEBHOOK_URL` | HTTP POST response `{ ok, status }` | Failure logged, execution continues without throwing | `ORIGINAL_REQUEST.md` & `ROADMAP.md` |
| F3 | Integrations | Slack Webhook Alerts | Dispatch formatted block notifications to Slack webhooks upon `ai_auto_actions` mutation. | `WebhookAlertPayload`, `SLACK_WEBHOOK_URL` | HTTP POST response `{ ok, status }` | Failure logged, execution continues without throwing | `ORIGINAL_REQUEST.md` & `ROADMAP.md` |
| F4 | Security | Asymmetric FDP Bus Payload Encryption & Signing | Encrypt FDP payloads and sign messages with RSA/ECDSA private key for cross-tenant privacy. | PEM key pairs (`FEDERATION_PRIVATE_KEY`, `FEDERATION_PUBLIC_KEY`), `FederationEvent` | Encrypted payload, asymmetric digital signature | Throws `"Invalid asymmetric federation signature"` or `"Payload decryption failed"` on tampered inputs | `lib/federation/bus.ts` & `ORIGINAL_REQUEST.md` |
| F5 | Database | PostgreSQL Prisma Migrations | Version-controlled database schema management using Prisma migrations. | Prisma schema (`prisma/schema.prisma`), PostgreSQL URL | SQL migration scripts under `prisma/migrations/` | Migration failure triggers transaction rollback | `prisma/schema.prisma` & `ROADMAP.md` |
| F6 | Quality | Complete Verification & Graph Maintenance | Automated local testing (Vitest, Playwright, Next build) and Knowledge Graph update. | Test suites, source files | Zero build errors, 100% test pass rate, updated graph JSON | Non-zero exit code halts CI/CD pipeline | `package.json` & `AGENTS.md` |

---

## 4. Edge Cases

| # | Feature | Input / Trigger | Observed & Required Behavior |
|---|---------|-----------------|------------------------------|
| E1 | Contextual Bandit | Variant with 0 impressions (cold start) | Assigned maximum exploration bonus ($\alpha \cdot \text{bound}$), ensuring initial trial sampling. |
| E2 | Contextual Bandit | High impressions but 0 conversions | Engagement score relies on CTR and normalized dwell time weight ratio without division by zero. |
| E3 | Webhook Alerts | Webhook endpoint returns HTTP 500 / Timeout | Error caught gracefully in `sendWebhookAlert`; return `{ ok: false, error }` without blocking DB auto-action log. |
| E4 | Webhook Alerts | `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` unconfigured | Alert dispatch skipped silently with debug log; function returns `{ ok: false, reason: "unconfigured" }`. |
| E5 | Asymmetric Bus | Incoming event signed with corrupted / mismatched private key | Signature verification fails; `ingest()` rejects event throwing `"Invalid asymmetric federation signature"`. |
| E6 | Asymmetric Bus | Asymmetric key missing but symmetric secret present | Fallback to HMAC signature mode for legacy compatibility. |

---

## 5. Caveats

- **Execution Boundary**: As Specification Miner, no code implementation was executed in source files during this phase. All specs are mined for implementation agents.
- **Database Target**: Local test environment requires PostgreSQL connection or Prisma mock setup when executing full migrations in R4.

---

## 6. Verification Method

To verify the implementation once completed by implementation agents:

1. **Unit Tests (Vitest)**:
   ```bash
   npm run test
   ```
2. **TypeScript & Production Build**:
   ```bash
   npm run build
   ```
3. **E2E Integration Tests (Playwright)**:
   ```bash
   npm run test:e2e
   ```
4. **Knowledge Graph Update**:
   ```bash
   graphify update .
   ```
