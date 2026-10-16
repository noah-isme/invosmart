# InvoSmart Federation Layer

InvoSmart v1.6 introduces a secure federation plane that enables multiple tenant instances to cooperate through telemetry
sharing, federated learning, and coordinated trust governance. This document covers the architecture, Federation Data
Protocol (FDP), and the distributed learning cycle executed by the new **FederationAgent**.

## Architecture Overview

```
┌─────────────────────┐        ┌─────────────────────┐
│ Instance A          │        │ Instance B          │
│  • OptimizerAgent   │        │  • OptimizerAgent   │
│  • LearningAgent    │        │  • LearningAgent    │
│  • GovernanceAgent  │        │  • GovernanceAgent  │
│  • InsightAgent     │        │  • InsightAgent     │
│  • FederationAgent  │◄──────►│  • FederationAgent  │
│        ▲            │        │            ▲        │
│        │ FDP        │        │ FDP        │        │
└────────┼────────────┘        └────────────┼────────┘
         │                                      │
         ▼                                      ▼
      Prisma DB                          Prisma DB
         │                                      │
         ▼                                      ▼
   FederationMetrics                    FederationMetrics
```

Each instance uses a shared gRPC-style secure bus (implemented via signed HTTPS event delivery) to share anonymised
metrics. The **FederationAgent** aggregates incoming telemetry, updates global trust vectors, and emits a consolidated
insight stream back to the core Orchestrator.

## Federation Data Protocol (FDP)

All events are signed and routed through `lib/federation/bus.ts`: RSA-SHA256 when `FEDERATION_PRIVATE_KEY` is set,
otherwise HMAC-SHA256 with `FEDERATION_HMAC_SECRET`. `FEDERATION_TOKEN_SECRET` is only the peer bearer token and never
signs events. Peers deliver events to `POST /api/federation/events` (see [Inbound events](#inbound-events)). FDP
currently exposes four event families:

| Event Type        | Description                                                                 | Key Payload Fields |
| ----------------- | --------------------------------------------------------------------------- | ------------------ |
| `telemetry_sync`  | Periodic heartbeat containing trust score, latency, and priority snapshot.  | `trustScore`, `priorities`, `syncLatencyMs` |
| `priority_share`  | Consensus weightings broadcast after each aggregation cycle.                | `cycleId`, `priorities`, `rationale` |
| `trust_aggregate` | Result of federated averaging across all connected tenants.                 | `averageTrust`, `participants`, `networkHealth` |
| `model_update`    | Applied model weights and trust vector shared for adaptive synchronisation. | `trustScore`, `priorities`, `appliedAt` |

All payloads are validated and sanitised (`sanitizeMetadata`) before emission. Sensitive fields like raw event logs,
PII, or session metadata are stripped automatically.

## Federated Learning Cycle

1. **Local Snapshot** – Each tenant runs `FederationAgent.broadcastLocalSnapshot()` which collects the latest
   trust score (`lib/ai/trustScore.ts`) and persisted priorities (`lib/ai/priority.ts`). The payload is sanitised and
   published as `telemetry_sync`.
2. **Aggregation** – Upon receiving remote telemetry, the agent builds a `FederationSnapshot` map and calculates:
   - Weighted priority averages (`deriveAggregatedPriorities`)
   - Trust statistics (`aggregateTrustScores`)
   - Latency trends and health classification (`analyzeGlobalFederation`)
3. **Global Insight** – Results are persisted to the new `FederationMetrics` Prisma model and emitted as:
   - `trust_aggregate` (global trust picture)
   - `priority_share` (harmonised agent weights)
   - `model_update` (applied cycle with trust baseline)
   - `insight_report` to the Orchestrator for downstream agents.
4. **Dashboard** – `/app/devtools/ai-federation` renders the network graph, trust history, and recent event log via
   `AiFederationClient`. Manual re-sync triggers a local snapshot and refreshes the dashboard state.

## Inbound events

`POST /api/federation/events` (`app/api/federation/events/route.ts`) checks the peer bearer, the body size and the FDP
schema, then calls `getFederationAgent()` so the agent's subscribers exist in this process, and hands the event to
`FederationBus.ingest()`. Ingest verifies the signature, rejects events outside a 5-minute clock window, records the
event in `FederationInboundEvent` (the unique signature hash rejects replays) and emits it to the subscribers. The
full HTTP contract is in [docs/INTEGRATIONS.md](../INTEGRATIONS.md#federation-peers).

The route verifies, records the event in `FederationInboundEvent`, and hands it to the FederationAgent handlers; effects
marked process-local are a known limitation.

| Handler (`lib/ai/federationAgent.ts`) | Effect of an accepted event | Durable? |
|---|---|---|
| (ingest) | `FederationInboundEvent` row (`accepted=true`; `false` for own-tenant echoes, which are not emitted) | **Persisted** |
| (ingest) | `FederationBus` recent-events ring buffer (last 25, shown on the status endpoint) | Process-local |
| `handleTelemetry` (`telemetry_sync`) | Upserts the sender's snapshot in the agent's in-memory map | Process-local |
| `handleTelemetry` → `evaluateGlobalNetwork` | `FederationMetrics` row for the cycle (`recordFederationMetrics`, upsert on `cycleId, tenantId`) | **Persisted** |
| `handleTelemetry` → `evaluateGlobalNetwork` | Local trust and model history entries | Process-local |
| `handleTelemetry` → `evaluateGlobalNetwork` | Publishes `trust_aggregate`, `priority_share` and `model_update` to the configured peers | Sent over HTTP (peers record them) |
| `handleTelemetry` → `evaluateGlobalNetwork` | `insight_report` MAP event via `dispatchEvent` (Redis stream and an `AgentEventLog` row), only when orchestration is enabled | **Persisted** when orchestration is on |
| `handlePriorityShare` (`priority_share`) | Same as telemetry: replaces the sender's priorities in the in-memory snapshot, then `evaluateGlobalNetwork` | Mixed, as above |
| `handleTrustAggregate` (`trust_aggregate`) | Prepends to the in-memory trust history and recomputes the latest insight | Process-local |
| `handleModelUpdate` (`model_update`) | Prepends to the in-memory model history | Process-local |

No handler writes `AgentPriority`: received priorities only feed the aggregate stored in `FederationMetrics`. On a
serverless deployment each instance starts with an empty snapshot map, so an aggregate computed after a cold start
covers only the peers that instance has heard from, and the DevTools snapshots and histories show only what that
instance received. Subscribers are also called without being awaited, so their database writes and outbound
publishes can still be running when the route has already answered `202`.

## Prisma Schema Additions

```prisma
model FederationMetrics {
  id                   String   @id @default(cuid())
  cycleId              String
  tenantId             String
  participants         Int
  averageTrust         Float
  medianTrust          Float
  trustStdDeviation    Float
  highestTenant        String?
  highestTrust         Float?
  lowestTenant         String?
  lowestTrust          Float?
  averageLatencyMs     Float?
  aggregatedPriorities Json
  summary              String?
  networkHealth        String  @default("healthy")
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([cycleId, tenantId])
}

model FederationInboundEvent {
  id                 String   @id @default(cuid())
  eventId            String
  tenantId           String
  type               String
  signatureAlgorithm String
  signatureHash      String   @unique
  eventTimestamp     DateTime
  receivedAt         DateTime @default(now())
  accepted           Boolean

  @@index([eventId])
  @@index([tenantId, receivedAt])
  @@index([receivedAt])
}
```

## Sample Federation Log

```json
{
  "type": "telemetry_sync",
  "tenantId": "tenant-alpha",
  "trustScore": 82.4,
  "priorities": [
    { "agent": "optimizer", "weight": 0.38, "confidence": 0.82 },
    { "agent": "federation", "weight": 0.09, "confidence": 0.74 }
  ],
  "syncLatencyMs": 214,
  "sanitized": true
}
```

```json
{
  "type": "trust_aggregate",
  "tenantId": "tenant-beta",
  "cycleId": "2025-02-08T04:20:00.123Z::telemetry",
  "participants": 3,
  "averageTrust": 76.1,
  "networkHealth": "degraded",
  "aggregatedPriorities": [
    { "agent": "optimizer", "weight": 0.36, "confidence": 0.81 },
    { "agent": "federation", "weight": 0.1, "confidence": 0.78 }
  ]
}
```

## Federation Dashboard Snapshot

The `/devtools/ai-federation` dashboard renders a live network map for every
connected tenant:

- **Graph Canvas** – React Flow displays each tenant as a node with colored
  trust state (green = healthy, amber = degraded, red = unstable). Animated
  edges represent active telemetry streams and show average sync latency in
  milliseconds.
- **Trust History Chart** – A Recharts area graph overlays the local tenant’s
  trust trend against the aggregated network median so deviations are easy to
  spot. Hovering reveals the contributing tenants and their respective weights.
- **Metrics Sidebar** – Summaries for participant count, most reliable tenant,
  slowest link, and last aggregation cycle time. Manual **Resync** triggers the
  `telemetry_sync` flow immediately and refreshes the graph.
- **Filters & Legends** – Tenant filters allow isolating specific cohorts (e.g.
  production vs. staging). Legends clarify edge coloring and trust thresholds,
  keeping the UI accessible in both light and dark modes.

## Validation & Operations Notes

- `POST /api/federation/events` accepts the peer bearer only (no session); it answers `503` when federation is disabled
  and, in production, when `FEDERATION_TOKEN_SECRET` is unset.
- HMAC peers must share `FEDERATION_HMAC_SECRET` and upgrade together: events from older peers that still sign HMAC
  with the bearer token are rejected.
- The `/api/federation/status` endpoint accepts either a peer bearer token equal to `FEDERATION_TOKEN_SECRET`
  (constant-time comparison) or a platform-admin session (`ADMIN_USER_IDS`). If `FEDERATION_TOKEN_SECRET` is unset or
  blank the bearer path is disabled and only platform-admin sessions are accepted; it never allows anonymous access.
  Side effect: a peer that runs without a shared secret (RSA-key-only federation) sends an empty bearer (`Bearer `), which
  is now rejected, so `checkConnections()` reports that peer as "down". Configure `FEDERATION_TOKEN_SECRET` on both
  sides for peer status checks to succeed. Manual re-sync POSTs trigger a fresh snapshot, enabling controlled synchronisation during incident response.
- `ENABLE_AI_FEDERATION=true` activates the bus singleton and registers `FederationAgent` with the Orchestrator registry.
- All dashboards and tests run with deterministic in-memory bus behaviour during CI (`NODE_ENV=test`).
- Lint (`npm run lint`), unit tests (`npm run test`), and build (`npm run build`) must pass with
  `ENABLE_AI_FEDERATION=true` prior to deployment.
