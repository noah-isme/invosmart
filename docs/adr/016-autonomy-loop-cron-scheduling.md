# 16. Autonomy Loop Scheduled by Cron

## Status
Accepted (2026-10-17). Supersedes the in-process scheduling part of [ADR 009](009-autonomous-loop-adaptive-scaling.md); the adaptive scaling decision itself stands.

## Context
[ADR 009](009-autonomous-loop-adaptive-scaling.md) introduced an autonomy loop (`runLoop()` in `lib/ai/loop.ts`) that rescheduled itself with a recursive `setTimeout`. That design assumed a long-lived server process. In production the app runs on Vercel serverless functions:

- The timer was only started when a platform admin pressed "Resume" in DevTools, and it lived in whichever function instance served that request. The instance is frozen or recycled shortly after, so the loop stopped without notice.
- The scaler's state (adaptive interval, concurrency, the previous tick's telemetry used for the priority signal) lived in a module-level `runtimeState` object, which is empty on every new invocation.
- The pause/resume switch was in memory too, so it did not apply to any other instance.

## Decision
- **Trigger**: a Vercel cron calls `GET /api/cron/autonomy` every 5 minutes (`vercel.json`), authorised by the `CRON_SECRET` bearer like the other crons. `?force=1` runs a tick that is not yet due.
- **State**: a singleton table `AutonomyLoopState` (`lib/ai/loop-scheduler.ts`) stores `paused`, `nextRunAt`, `lastRunAt`, the scaler state carried between ticks (`lastIntervalMs`, `lastConcurrency`, `lastTelemetry`) and the last summary and result. Each tick passes the stored state into `runLoop()` and writes the new values back.
- **Due test**: a tick runs when `nextRunAt` is unset or at most 30 s in the future. The tolerance absorbs cron jitter; without it a cron firing a second before `nextRunAt` would skip and double the effective interval.
- **Interval floor**: `nextRunAt = now + max(adaptive interval, 5 min)`. The scaler still computes 1 to 15 minutes, but the effective minimum interval in production is 5 minutes, the cron period.
- **Overlap**: a tick claims the row with a conditional update on `claimedUntil` (4-minute lease). An overlapping invocation answers `skipped: "locked"`; a crashed tick blocks the next one for at most the lease.
- **Paused by default**: the row is created with `paused = true`. Production ticks begin only after a platform admin resumes the loop in DevTools (`/devtools/ai-autonomy`, which calls `POST /api/devtools/autonomy` and now persists the flag). Until then every cron call answers `skipped: "paused"`. This keeps a deploy from starting recovery sweeps and automatic rollbacks on its own.
- **Local development**: `startAutonomyLoop()` and its `setTimeout` loop remain, for local dev only. DevTools pause/resume drives both the timer and the persisted flag.

Rejected: keeping the schedule in Redis (optional dependency, not configured everywhere) or in `FeatureFlag` rows (a flag table is not a scheduler).

## Consequences
### Positive
*   The loop runs in production on a fixed cadence without a long-lived process, and survives deploys and cold starts.
*   The adaptive interval, concurrency and priority signal behave as ADR 009 intended, because their inputs persist between ticks.
*   Pause and resume apply to every instance. The cron response and the DevTools state show whether the loop is paused.

### Negative / Trade-offs
*   The minimum interval in production is 5 minutes instead of 1.
*   Forgetting to resume the loop after the first deploy means it silently never runs. The rollout step is in [DEPLOYMENT.md](../DEPLOYMENT.md#scheduled-jobs).
*   A tick can run up to 30 s before its `nextRunAt`.
*   The in-memory telemetry history shown in DevTools covers only the current instance's runs; only the last telemetry is persisted.
*   One more table and one more cron entry (five in total).
