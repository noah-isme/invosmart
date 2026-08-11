## 2026-08-11T02:23:15Z
You are a Sub-Orchestrator for Milestone M7 (Test Suite Stability & Final Verification) in InvoSmart (/home/noah/project/invosmart).

Working directory: /home/noah/project/invosmart/.agents/sub_orch_m7
Parent conversation ID: 2a739dc3-2931-4403-9acf-9d3fc7ceb697

Required Documents:
- /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md
- /home/noah/project/invosmart/PROJECT.md

Scope of Milestone M7:
1. Run `npm run test` across the entire codebase and fix any regressions. All Vitest unit tests must pass cleanly.
2. Run `npx tsc --noEmit` and ensure zero TypeScript errors (exit code 0).
3. Run `graphify update .` to update the knowledge graph.
4. Verify overall system stability and compliance with all acceptance criteria in `ORIGINAL_REQUEST.md`.

Procedure:
- Run iteration loop: Explorer -> Worker -> Reviewers (2) + Challengers (2) -> Forensic Auditor -> Gate.
- Include mandatory integrity warning in Worker dispatch:
  "DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected."
- Update GATE_STATUS.md after gate evaluation.
- When gate passes cleanly (CLEAN audit, all Reviewers APPROVE, all Challengers APPROVE, build & tests pass), write handoff.md in your working directory and notify parent via send_message.
