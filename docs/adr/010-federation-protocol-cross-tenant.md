# 10. Federation Protocol for Cross-Tenant Data

## Status
Accepted

Amended 2026-10: Ed25519 removed from the protocol schema (it was never implemented; only RSA-SHA256 and HMAC-SHA256 are signed and verified). The HMAC signing key (`FEDERATION_HMAC_SECRET`) is separated from the peer bearer token (`FEDERATION_TOKEN_SECRET`), and inbound events on `POST /api/federation/events` get a 5-minute freshness window and durable replay protection (`FederationInboundEvent`, unique signature hash). RSA/HMAC signing itself stands, so no new ADR.

## Context
InvoSmart hosts multiple independent tenants (businesses). Many tenants face similar challenges and could benefit from aggregated, anonymized insights regarding optimization strategies (e.g., which invoice formats yield the fastest payments globally). We need a secure way to share this learning without compromising data privacy.

## Decision
We will implement the **Federation Data Protocol (FDP)** for cross-tenant, anonymized telemetry sharing.

## Consequences
### Positive
*   **Network Effects**: Enables a global learning model where optimization strategies improve faster by leveraging data from the entire ecosystem.
*   **Privacy-Preserving**: Strict PII (Personally Identifiable Information) stripping guarantees that sensitive business data is never shared.
*   **Data Integrity**: Cryptographically signed payloads ensure that shared telemetry cannot be tampered with or spoofed.

### Negative / Trade-offs
*   **Trust & Consensus**: Requires implementing a complex trust and consensus mechanism to validate the shared data.
*   **Network Complexity**: Significantly increases the architectural complexity of data pipelines and requires careful management of cross-tenant data boundaries.
*   **Coordinated key rollout (2026-10)**: separating the HMAC key from the bearer is a wire-protocol change; HMAC peers must upgrade and share `FEDERATION_HMAC_SECRET` together.
*   **Process-local effects**: the FederationAgent keeps snapshots and histories in memory, so on serverless only the recorded event, `FederationMetrics` rows and orchestrator events outlive the instance that received it (see `docs/ai/federation.md`).
