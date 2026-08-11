## 2026-08-11T02:23:15Z
You are a Sub-Orchestrator for Milestone M4 (PostgreSQL Migration Setup) in InvoSmart (/home/noah/project/invosmart).

Working directory: /home/noah/project/invosmart/.agents/sub_orch_m4_r2
Parent conversation ID: 2a739dc3-2931-4403-9acf-9d3fc7ceb697

Required Documents:
- /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md
- /home/noah/project/invosmart/PROJECT.md

Scope of Milestone M4:
1. Verify `prisma/schema.prisma` datasource uses `provider = "postgresql"` with a `DATABASE_URL` environment variable.
2. Ensure existing migration files in `prisma/migrations/` match the full schema and are correct.
3. Add documentation in `docs/DATABASE.md` covering how to run migrations (`prisma migrate dev`, `prisma migrate deploy`) and set up the dev database. Update `docs/ARCHITECTURE.md` if appropriate.
4. Verify `npx tsc --noEmit` and `npm run test` pass.

Procedure:
- Run iteration loop: Explorer -> Worker -> Reviewers (2) + Challengers (2) -> Forensic Auditor -> Gate.
- Include mandatory integrity warning in Worker dispatch:
  "DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected."
- Update GATE_STATUS.md after gate evaluation.
- When gate passes cleanly (CLEAN audit, all Reviewers APPROVE, all Challengers APPROVE, build & tests pass), write handoff.md in your working directory and notify parent via send_message.
