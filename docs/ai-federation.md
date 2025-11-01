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

All events are signed using `FEDERATION_TOKEN_SECRET` and routed through `lib/federation/bus.ts`. FDP currently exposes
four event families:

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

- The `/api/federation/status` endpoint enforces bearer token validation and falls back to authenticated DevTools
  sessions. Manual re-sync POSTs trigger a fresh snapshot, enabling controlled synchronisation during incident response.
- `ENABLE_AI_FEDERATION=true` activates the bus singleton and registers `FederationAgent` with the Orchestrator registry.
- All dashboards and tests run with deterministic in-memory bus behaviour during CI (`NODE_ENV=test`).
- Lint (`npm run lint`), unit tests (`npm run test`), and build (`npm run build`) must pass with
  `ENABLE_AI_FEDERATION=true` prior to deployment.
