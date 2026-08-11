# BRIEFING — 2026-08-11T02:08:00Z

## Mission
Sub-orchestrator for Milestone M4 (PostgreSQL Migration & Proper DB Migrations)

## 🔒 My Identity
- Archetype: teamwork_orchestrator
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: /home/noah/project/invosmart/.agents/sub_orch_m4
- Original parent: parent
- Original parent conversation ID: 4ffe1eaf-c2f9-4195-a660-6e3ebc272daa

## 🔒 My Workflow
- **Pattern**: Project Sub-orchestrator
- **Scope document**: /home/noah/project/invosmart/PROJECT.md
1. **Decompose**: Milestone M4 (PostgreSQL Migration & Proper DB Migrations)
2. **Dispatch & Execute**:
   - Direct iteration loop: Explorer(s) -> Worker -> Reviewers (2) + Challengers (2) -> Forensic Auditor -> Gate
3. **On failure**: Retry -> Replace -> Skip -> Redistribute -> Redesign -> Escalate
4. **Succession**: Spawn count limit 20
- **Work items**:
  1. M4 PostgreSQL Migration & DB Migrations [in-progress]
- **Current phase**: 2 (Iteration Loop)
- **Current focus**: Iteration 1 - Exploration & Worker dispatch

## 🔒 Key Constraints
- NEVER write, modify, or create source code files directly.
- NEVER run build/test commands yourself — require workers to do so.
- NEVER investigate or explore the problem at the code level — dispatch Explorers for technical investigation.
- Always include path to ORIGINAL_REQUEST.md in subagent dispatches.
- Include verbatim integrity warning in Worker dispatch.

## Current Parent
- Conversation ID: 4ffe1eaf-c2f9-4195-a660-6e3ebc272daa
- Updated: 2026-08-11T02:08:00Z

## Key Decisions Made
- Executing iteration loop for Milestone M4.

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|
| explorer_m4_1 | teamwork_preview_explorer | Prisma & PostgreSQL Schema Analysis | completed | ccb71a59-86f7-4e8e-a138-a177671cc89a |
| explorer_m4_2 | teamwork_preview_explorer | Migration & Docs Analysis | completed | 31f79d47-c802-4d22-b37a-d13c7df0e7cd |
| explorer_m4_3 | teamwork_preview_explorer | Scripts & Environment Analysis | completed | e7ae9b44-3678-4927-9164-f3115d47b095 |
| worker_m4_1 | teamwork_preview_worker | M4 Implementation | in-progress | 7b1e2573-681b-4099-b31d-0c43c1b5b5c2 |

## Succession Status
- Succession required: no
- Spawn count: 4 / 20
- Pending subagents: 7b1e2573-681b-4099-b31d-0c43c1b5b5c2
- Predecessor: none
- Successor: not yet spawned

## Active Timers
- Heartbeat cron: task-9
- Safety timer: none

## Artifact Index
- /home/noah/project/invosmart/.agents/sub_orch_m4/DISPATCH.md — Dispatch instructions
- /home/noah/project/invosmart/.agents/sub_orch_m4/BRIEFING.md — Persistent working memory
- /home/noah/project/invosmart/.agents/sub_orch_m4/progress.md — Liveness & progress tracking
