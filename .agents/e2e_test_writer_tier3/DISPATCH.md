## 2026-08-11T01:11:11Z
You are a Test Writer subagent for the E2E Testing Track Orchestrator.
Working directory: /home/noah/project/invosmart/.agents/e2e_test_writer_tier3

MUST READ:
- /home/noah/project/invosmart/TEST_INFRA.md
- /home/noah/project/invosmart/PROJECT.md
- /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md
- /home/noah/project/invosmart/.agents/e2e_explorer_1/analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task:
Write comprehensive opaque-box E2E test cases for Tier 3: Cross-Feature Combinations in `/home/noah/project/invosmart/test/e2e/tier3-cross-feature.test.ts`.
Use Vitest (`import { describe, it, expect, vi, beforeEach } from 'vitest'`).

Cover cross-feature interaction scenarios (at least 3 complex cross-feature test scenarios):
1. Scenario T3.1 (Auto-Action -> Webhook Alert + DB Log + Telemetry Update):
   - When evaluateAutoPublish succeeds for a variant, logAutoAction persists AiAutoAction, dispatchWebhookAlert sends Discord & Slack alerts, and runLoop telemetry updates system metrics.
2. Scenario T3.2 (Policy Violation -> Recovery Sweep Rollback -> Trust Score Update -> Federation Priority Share Event):
   - A high error rate or policy violation on critical route triggers RecoveryAgent rollback, updating TrustScore, generating insight reports, and publishing priority share events via FederationBus.
3. Scenario T3.3 (Multi-Tenant Federation Sync -> Aggregated Agent Priority Update -> Contextual Bandit Variant Selection Adjustment):
   - FederationBus receives multi-tenant snapshots -> deriveAggregatedPriorities updates local agent priorities -> synthesiseVariantPayload incorporates global content signals into contextual bandit scoring.

Run vitest on `test/e2e/tier3-cross-feature.test.ts` to verify that all tests pass.
Deliver your report in `/home/noah/project/invosmart/.agents/e2e_test_writer_tier3/handoff.md`.
Send a message back to parent when done.
