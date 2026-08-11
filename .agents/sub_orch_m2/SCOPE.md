# Scope: Milestone 2 (R2: Real-time Webhook Alerts)

## Architecture
- `lib/ai/webhooks.ts`: Webhook alert dispatch engine supporting Discord embeds and Slack Block Kit payload formatters. Asynchronously dispatches notifications based on `DISCORD_WEBHOOK_URL` and `SLACK_WEBHOOK_URL`. Handles missing environment variables and HTTP network errors gracefully without blocking core execution.
- `lib/ai/approval-gates.ts`: Integrated with `dispatchWebhookAlert` within `logAutoAction()` and `markAutoActionReverted()`.
- `lib/__tests__/webhooks.test.ts`: Comprehensive unit tests verifying Discord embeds, Slack Block Kit formatting, async dispatching, unconfigured URL handling, and HTTP error/timeout resilience.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 2 | Discord Webhook Alerts | Embed notification payload formatting & dispatch on AiAutoAction mutations | M2 | ORIGINAL_REQUEST.md & ROADMAP.md |
| 3 | Slack Webhook Alerts | Block Kit notification payload formatting & dispatch on AiAutoAction mutations | M2 | ORIGINAL_REQUEST.md & ROADMAP.md |

## Interface Contracts
### M2 ↔ Approval Gates / Auto Actions
- `dispatchWebhookAlert(action: AiAutoAction | Record<string, any>)`: Asynchronously dispatches formatted Discord embed & Slack Block Kit payloads to `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL`. Degrades gracefully on missing URLs or HTTP errors.
- `logAutoAction(...)`: Invokes `dispatchWebhookAlert` upon creating an `AiAutoAction`.
- `markAutoActionReverted(...)`: Invokes `dispatchWebhookAlert` upon updating an `AiAutoAction` status to `reverted`.

## Code Layout
- `lib/ai/webhooks.ts`: Exclusive to Milestone M2.
- `lib/ai/approval-gates.ts`: Modified by Milestone M2 to integrate `dispatchWebhookAlert`.
- `lib/__tests__/webhooks.test.ts`: Exclusive unit test file for Milestone M2.

## Verification Criteria
- All Vitest tests pass (`npm run test`).
- `npm run build` succeeds.
- Reviewer, Challenger, and Auditor gates pass with CLEAN verdicts.
