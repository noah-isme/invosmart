# 4. Upstash Redis Event Bus

## Status
Accepted

## Context
The Multi-Agent Protocol (MAP) requires a fast, reliable message broker for event streaming. Since our infrastructure relies heavily on Vercel's serverless environment, the chosen broker must integrate seamlessly with serverless architectures, supporting stateless connections and scaling out of the box.

## Decision
We will use **Upstash Redis** (serverless) as the event stream backend, with an in-memory fallback for development and testing.

## Consequences
### Positive
*   **Serverless Compatibility**: Upstash uses REST-based connection mechanisms that do not suffer from connection limits in serverless edge environments.
*   **Maintenance Free**: Fully managed and auto-scaling, eliminating the need to provision or manage Redis nodes.
*   **Developer Experience**: The in-memory fallback ensures that local development and automated test suites can run entirely without requiring a real Redis instance or network connectivity.

### Negative / Trade-offs
*   **Latency**: REST-based communication introduces higher latency compared to a traditional, persistent TCP connection to a native Redis server.
*   **Cost Scaling**: Pricing scales per request, which can become expensive at extremely high event volumes compared to fixed-cost infrastructure.
