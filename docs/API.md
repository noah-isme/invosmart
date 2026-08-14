# InvoSmart Customer API

The customer API is a workspace-scoped, versioned HTTP API for invoice and
client automation. It is deliberately separate from the browser session API:
existing `/api/*` routes remain compatible while integrations use `/api/v1/*`.

## Authentication

API keys are created from workspace settings by an `OWNER` or `ADMIN`. The raw
key is displayed only once. The database stores a digest, never the raw secret.

```http
Authorization: Bearer inv_live_<16-hex-prefix>_<secret>
```

Each key belongs to one workspace and has explicit scopes:

- `invoices:read`
- `invoices:write`
- `clients:read`
- `clients:write`

Expired or revoked keys return `401`. A valid key without the required scope
returns `403`. A key cannot select or authorize a different workspace.

## Version 1 resources

| Method | Path | Scope |
| --- | --- | --- |
| `GET` | `/api/v1/invoices` | `invoices:read` |
| `POST` | `/api/v1/invoices` | `invoices:write` |
| `GET` | `/api/v1/invoices/{id}` | `invoices:read` |
| `PATCH` | `/api/v1/invoices/{id}` | `invoices:write` |
| `DELETE` | `/api/v1/invoices/{id}` | `invoices:write` |
| `GET` | `/api/v1/clients` | `clients:read` |
| `POST` | `/api/v1/clients` | `clients:write` |
| `GET` | `/api/v1/clients/{id}` | `clients:read` |
| `PATCH` | `/api/v1/clients/{id}` | `clients:write` |
| `DELETE` | `/api/v1/clients/{id}` | `clients:write` |

List endpoints accept `limit` and `cursor`. The server applies workspace
filters before any resource identifier is resolved. Unknown resources return
`404` so identifiers from another workspace are not disclosed.

Create operations require an `Idempotency-Key`. Repeating a key with the same
request returns the original result; reusing it with a different request
returns `409`. The beta guard is process-local; the v1.4 GA gate requires the
same contract to be verified through the durable/distributed deployment path.

## Response contract

Successful responses use:

```json
{
  "data": {},
  "meta": { "nextCursor": null, "hasMore": false, "limit": 20 },
  "requestId": "..."
}
```

Errors use a stable code and a request identifier:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The payload is invalid",
    "details": {}
  },
  "requestId": "..."
}
```

Clients should use the HTTP status and `error.code`, not localized message
text, for retry and remediation decisions. Rate-limited responses include
`Retry-After` and the applicable limit headers.

## OpenAPI and compatibility

The machine-readable contract is available at `/api/openapi.json`. The
developer-facing documentation renders the same contract and includes cURL
examples. Version 1 does not introduce breaking changes after GA; breaking
changes require a new `/api/v2` surface and a deprecation notice of at least
90 days.

## Operational requirements

- Record key creation, revocation, authentication failures, and mutating API
  calls in the existing audit log with the workspace and request ID.
- The v1 beta uses a process-local guard keyed by API-key identity and exposes
  limit state in response headers. Before v1.4 GA, configure the distributed
  Upstash limiter and retain the local guard only as an outage fallback.
- Track request count, latency, status, scope, and resource outcome without
  recording raw API keys or sensitive invoice contents.
- Keep provider/payment, reminder, and workspace-administration resources out
  of v1 until their staging certification gates are complete.
