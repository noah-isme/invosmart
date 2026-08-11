## 2026-08-10T18:11:11Z

You are a Test Writer subagent for the E2E Testing Track Orchestrator.
Working directory: /home/noah/project/invosmart/.agents/e2e_test_writer_tier4

MUST READ:
- /home/noah/project/invosmart/TEST_INFRA.md
- /home/noah/project/invosmart/PROJECT.md
- /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md
- /home/noah/project/invosmart/.agents/e2e_explorer_1/analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task:
Write comprehensive opaque-box E2E test cases for Tier 4: Real-World Application Scenarios in `/home/noah/project/invosmart/test/e2e/tier4-realworld-scenarios.test.ts`.
Use Vitest (`import { describe, it, expect, vi, beforeEach } from 'vitest'`).

Cover end-to-end real-world workload application scenarios (at least 2 application scenarios):
1. Scenario T4.1 (Complete End-to-End Autonomous Optimization Cycle):
   - Simulate user invoice content creation -> startExperiment baseline -> generateVariant contextual bandit synthesis -> ingest impression/click analytics via recordVariantPerformance -> confidence threshold met -> evaluateAutoPublish auto-publish decision -> dispatchWebhookAlert Discord/Slack notification -> runLoop autonomous telemetry sweep.
2. Scenario T4.2 (End-to-End Invoice Financial Consistency & Recovery Audit Scenario):
   - Simulate performance regression on invoice processing -> runLoop telemetry detection -> RecoveryAgent triggers automatic rollback -> verify invoice total balance and payment receipts remain 100% accurate and consistent without data loss.

Run vitest on `test/e2e/tier4-realworld-scenarios.test.ts` to verify that all tests pass.
Deliver your report in `/home/noah/project/invosmart/.agents/e2e_test_writer_tier4/handoff.md`.
Send a message back to parent when done.
