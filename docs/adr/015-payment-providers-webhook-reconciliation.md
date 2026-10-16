# 15. Payment Providers and Webhook Reconciliation

## Status
Accepted (2026-10-16, recorded retroactively).

## Context
Invoices are paid online in two markets: cards and international payments through **Stripe**, and Indonesian local methods through **Midtrans**. Provider webhooks can arrive late, more than once, or out of order, and a user may click "pay" twice. Recording a payment twice, or marking an invoice paid without verified money, is a financial error.

## Decision
- **Providers**: Stripe Checkout (`lib/payments/stripe.ts`) and Midtrans Snap (`lib/payments/midtrans.ts`), started by a workspace member with `write` permission.
- **Payment attempts**:
  - Each checkout is a `PaymentAttempt`, created before the provider is called, with an idempotency key. It is unique per `(provider, idempotencyKey)` and per `(provider, providerOrderId)`.
  - An active attempt (`PENDING` or `AUTHORIZED`) is reused for 30 minutes (`lib/payments/lifecycle.ts`).
  - States: `PENDING`, `AUTHORIZED`, `SETTLED`, `EXPIRED`, `CANCELLED`, `FAILED`, `REFUNDED`. Transitions are decided by `decidePaymentTransition`.
- **Webhooks**:
  - Each event is authenticated by its provider signature: Stripe `constructEvent`, Midtrans `verifyMidtransSignature`.
  - Each event is stored once in `PaymentEvent`, unique on `(provider, providerEventId)`.
  - Amount and currency are re-verified against the invoice on every event.
- **Settlement** (`settleInvoiceOnce`, `lib/payments/settlement.ts`):
  - Locks the attempt and the invoice, and records at most one `Payment` per attempt.
  - A second real settlement of an already-paid invoice is not recorded as a payment. It is marked in the attempt metadata (`duplicateSettlement` / `reviewRequired`) for refund or manual review.
  - Refunds update `refundedAmount`. A fully refunded payment no longer counts as settling the invoice.

## Consequences
### Positive
*   **No double counting**: retries, replays and races cannot double-count money.
*   **Audit trail**: the provider's record of each event is preserved in `PaymentEvent`.

### Negative / Trade-offs
*   **Two integrations to maintain**: different signatures, status models and sandbox setups.
*   **Duplicate settlements need people**: a captured duplicate needs a manual refund, and there is no automated refund flow.
*   **`PaymentAttemptStatus` has no "duplicate" value**: duplicates are found through metadata, not status.
