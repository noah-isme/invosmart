# Architecture Decision Records (ADR)

This directory contains the Architecture Decision Records (ADRs) for the InvoSmart project. We use ADRs to document significant architectural decisions, their context, and the resulting consequences.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [001](001-nextjs-app-router.md) | [Use Next.js 15 with App Router](001-nextjs-app-router.md) | Accepted |
| [002](002-prisma-orm-multi-db.md) | [Prisma ORM Multi-DB Strategy](002-prisma-orm-multi-db.md) | Superseded by [011](011-postgresql-only.md) |
| [003](003-multi-agent-map-protocol.md) | [Multi-Agent Protocol (MAP)](003-multi-agent-map-protocol.md) | Accepted |
| [004](004-upstash-redis-event-bus.md) | [Upstash Redis Event Bus](004-upstash-redis-event-bus.md) | Accepted |
| [005](005-openai-with-gemini-fallback.md) | [OpenAI with Gemini Fallback](005-openai-with-gemini-fallback.md) | Superseded by [012](012-gemini-first-ai-provider.md) |
| [006](006-thompson-sampling-ab-testing.md) | [Thompson Sampling for A/B Testing](006-thompson-sampling-ab-testing.md) | Superseded by [013](013-linucb-content-selection.md) |
| [007](007-sentry-posthog-observability.md) | [Sentry and PostHog Observability](007-sentry-posthog-observability.md) | Accepted |
| [008](008-glassmorphism-design-system.md) | [Glassmorphism Design System](008-glassmorphism-design-system.md) | Accepted |
| [009](009-autonomous-loop-adaptive-scaling.md) | [Autonomous Loop Adaptive Scaling](009-autonomous-loop-adaptive-scaling.md) | Accepted |
| [010](010-federation-protocol-cross-tenant.md) | [Federation Protocol for Cross-Tenant Data](010-federation-protocol-cross-tenant.md) | Accepted |
| [011](011-postgresql-only.md) | [PostgreSQL in Every Environment](011-postgresql-only.md) | Accepted |
| [012](012-gemini-first-ai-provider.md) | [Gemini-First LLM Provider Selection](012-gemini-first-ai-provider.md) | Accepted |
| [013](013-linucb-content-selection.md) | [LinUCB Contextual Bandit for Content Variant Scoring](013-linucb-content-selection.md) | Accepted |
| [014](014-workspace-tenancy-rbac.md) | [Workspace Tenancy and Role-Based Access](014-workspace-tenancy-rbac.md) | Accepted |
| [015](015-payment-providers-webhook-reconciliation.md) | [Payment Providers and Webhook Reconciliation](015-payment-providers-webhook-reconciliation.md) | Accepted |

## Conventions

- ADRs are immutable once accepted. To change a decision, add a new ADR and set the old one's status to `Superseded by [NNN](…)`.
- Use the existing sections: Status, Context, Decision, Consequences (Positive / Negative).
- Decisions found in the code without an ADR are recorded retroactively and say so in their Status line.
