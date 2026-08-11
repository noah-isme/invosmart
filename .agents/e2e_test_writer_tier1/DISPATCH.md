## 2026-08-11T01:11:11Z

You are a Test Writer subagent for the E2E Testing Track Orchestrator.
Working directory: /home/noah/project/invosmart/.agents/e2e_test_writer_tier1

MUST READ:
- /home/noah/project/invosmart/TEST_INFRA.md
- /home/noah/project/invosmart/PROJECT.md
- /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md
- /home/noah/project/invosmart/.agents/e2e_explorer_1/analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task:
Write comprehensive opaque-box E2E test cases for Tier 1: Feature Coverage in `/home/noah/project/invosmart/test/e2e/tier1-feature-coverage.test.ts`.
Use Vitest (`import { describe, it, expect, vi, beforeEach } from 'vitest'`).

Cover these 4 features (minimum 5 test cases per feature = 20 test cases):
1. Feature 1 (Contextual Bandit R1 in lib/ai/content-local-optimizer.ts):
   - LinUCB reward scoring (weighted CTR 0.45, conversions 0.40, dwell 0.15)
   - Dynamic variant synthesis across HOOK, CAPTION, CTA, SCHEDULE
   - Performance recording & weight updates via recordVariantPerformance
   - Full experiment lifecycle (startExperiment -> generateVariant -> recordVariantPerformance -> chooseWinner)
   - Dynamic confidence calculation growth with sample size
2. Feature 2 (Webhooks R2 in lib/ai/webhooks.ts & lib/ai/approval-gates.ts):
   - Discord Embed formatting for AUTOPUBLISH, SCHEDULE_UPDATE, AUTO_REVERT
   - Slack Block Kit formatting with section & context blocks
   - Dual webhook dispatch executing fetch POST requests to DISCORD_WEBHOOK_URL & SLACK_WEBHOOK_URL
   - Approval gate evaluateAutoPublish integration
   - Revert action alert dispatch via markAutoActionReverted
3. Feature 3 (Asymmetric Federation Bus R3 in lib/federation/bus.ts & protocol.ts):
   - RSA/Ed25519 asymmetric signature generation & verification
   - Hybrid AES-256-GCM payload encryption & decryption
   - Event pub/sub subscriptions for telemetry_sync, priority_share, trust_aggregate, model_update
   - PII/secret sanitization via sanitizeMetadata
   - Multi-tenant priority & trust score aggregation
4. Feature 4 (DB & System Loop R4 in prisma/schema.prisma, lib/ai/loop.ts, lib/ai/orchestrator.ts, lib/ai/policy.ts, lib/ai/trustScore.ts):
   - Prisma composite index query verification on Invoice, OptimizationLog, ExplanationLog
   - Autonomous loop runLoop execution and telemetry ingestion
   - Adaptive interval calculation based on system metrics
   - Governance policy evaluation & route protection
   - Composite trust score calculation (50% success, 30% rollback, 20% policy compliance)

Run vitest on `test/e2e/tier1-feature-coverage.test.ts` to verify that all tests pass.
Deliver your report in `/home/noah/project/invosmart/.agents/e2e_test_writer_tier1/handoff.md`.
Send a message back to parent when done.
