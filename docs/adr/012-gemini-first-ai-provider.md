# 12. Gemini-First LLM Provider Selection

## Status
Accepted (2026-10-16, recorded retroactively). Supersedes [ADR 005](005-openai-with-gemini-fallback.md).

Amended 2026-10: automatic failover to the other provider and a per-request timeout (see Decision and Consequences).

## Context
ADR 005 named OpenAI GPT-4o-mini as the primary model with Gemini as an automatic fallback. The shipped client (`lib/ai.ts`) does the opposite: Gemini is primary whenever its key is configured. Until the 2026-10 amendment it had no runtime failover and picked one provider when it was created.

## Decision
- **Provider choice**: `lib/ai.ts` uses **Google Gemini** (`gemini-2.5-flash`, REST `generateContent`) when `GEMINI_API_KEY` is set. Otherwise it uses **OpenAI** (`gpt-4o-mini`) via `OPENAI_API_KEY`. If neither key is set, it throws.
- **Response shape**: both providers are exposed through the same `client.chat.completions.create` shape (`createGeminiAdapter` / `createOpenAiAdapter` in `lib/ai.ts`; `DEFAULT_MODEL` keeps the primary's default model).
- **Failover (amended 2026-10)**: when both keys are set, a retryable error from the primary (timeout or abort, network error, HTTP 408/429/5xx) is retried **once** on the other provider, with a model that belongs to the primary swapped for the other provider's default (`resolveModelForProvider`). HTTP 400/401/403/404 and any error when only one key is set propagate to the caller. Each failover logs `ai provider failover` with `{ from, to, reason }` only (no keys or prompts).
- **Timeout (amended 2026-10)**: every provider call is aborted after `AI_REQUEST_TIMEOUT_MS` (default 20000 ms).

## Consequences
### Positive
*   **Simple**: the primary provider is chosen by configuration and easy to reason about.
*   **Survives a provider outage**: with both keys set, a Gemini outage or timeout falls through to OpenAI (and the reverse when OpenAI is primary).
*   **Easy to switch**: change environment variables; route handlers don't change.

### Negative / Trade-offs
*   **Failover only with both keys**: a deployment with a single key still degrades during that provider's outage.
*   **Worst-case latency doubles on failover**: a timed-out primary plus the secondary call can take up to twice `AI_REQUEST_TIMEOUT_MS`; set it below any caller's own deadline.
*   **Mixed output within a deployment**: a failed-over request is answered by the other model, so prompts must tolerate both.
*   **Different output per environment**: environments with different keys produce different model output, so prompts must tolerate both.
*   **Key in the URL**: the Gemini key is sent as a query parameter to the Google endpoint, so request URLs must not be logged.
