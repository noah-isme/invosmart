# 3. Multi-Agent Protocol (MAP)

## Status
Accepted

## Context
Our architecture includes 6 distinct AI agents that need to collaborate to accomplish complex tasks. They require deterministic communication, event persistence, and a robust way to resolve conflicts when multiple agents attempt to modify the same resource or state.

## Decision
We will implement a custom **Multi-Agent Protocol (MAP)** for AI agent coordination.

## Consequences
### Positive
*   **Conflict Resolution**: Governance-first resolution using a strict priority system (90 > 85 > 75 > 60 > 45 > 35) ensures deterministic outcomes during conflicts.
*   **Persistence & Reliability**: Integration with Redis Streams ensures that messages are persisted and can be replayed or audited.
*   **Data Integrity**: Using Zod for event validation guarantees that all inter-agent communication adheres to a strict schema.
*   **Autonomy**: Enables autonomous self-healing capabilities as agents can reliably react to system states.

### Negative / Trade-offs
*   **Complexity**: Significantly more complex to implement and maintain than a standard message queue.
*   **Overhead**: Strict validation and priority resolution add slight processing overhead to every event.
