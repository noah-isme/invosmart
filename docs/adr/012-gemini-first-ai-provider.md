# 12. Gemini-First LLM Provider Selection

## Status
Accepted (2026-10-16, recorded retroactively). Supersedes [ADR 005](005-openai-with-gemini-fallback.md).

## Context
ADR 005 named OpenAI GPT-4o-mini as the primary model with Gemini as an automatic fallback. The shipped client (`lib/ai.ts`) does the opposite and has no runtime failover. It picks one provider when it is created, based on which key is configured.

## Decision
- **Provider choice**: `lib/ai.ts` uses **Google Gemini** (`gemini-2.5-flash`, REST `generateContent`) when `GEMINI_API_KEY` is set. Otherwise it uses **OpenAI** (`gpt-4o-mini`) via `OPENAI_API_KEY`. If neither key is set, it throws.
- **Response shape**: both providers are exposed through the same `client.chat.completions.create` shape (`lib/ai.ts:146`, `DEFAULT_MODEL`).
- **No failover**: a Gemini error is returned to the caller and is not retried on OpenAI.

## Consequences
### Positive
*   **Simple**: one provider per deployment, chosen by configuration and easy to reason about.
*   **Easy to switch**: change environment variables; route handlers don't change.

### Negative / Trade-offs
*   **No automatic failover**: a Gemini outage degrades AI features even when an OpenAI key is also configured.
*   **Different output per environment**: environments with different keys produce different model output, so prompts must tolerate both.
*   **Key in the URL**: the Gemini key is sent as a query parameter to the Google endpoint, so request URLs must not be logged.
