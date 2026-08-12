-- Track checkout attempts separately from settled payments. Attempts are
-- provider-facing state machines; Payment remains the settlement ledger.
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'SETTLED', 'EXPIRED', 'CANCELLED', 'FAILED', 'REFUNDED');

CREATE TYPE "PaymentEventType" AS ENUM ('PENDING', 'AUTHORIZED', 'SETTLED', 'EXPIRED', 'CANCELLED', 'FAILED', 'REFUNDED');

ALTER TABLE "Payment"
  ADD COLUMN "attemptId" TEXT,
  ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerSessionId" TEXT,
    "providerPaymentId" TEXT,
    "providerToken" TEXT,
    "checkoutUrl" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" "PaymentEventType" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL,
    "amount" INTEGER,
    "currency" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_attempt_provider_idempotency_key"
  ON "PaymentAttempt"("provider", "idempotencyKey");
CREATE UNIQUE INDEX "payment_attempt_provider_order_id"
  ON "PaymentAttempt"("provider", "providerOrderId");
CREATE UNIQUE INDEX "payment_event_provider_event_id"
  ON "PaymentEvent"("provider", "providerEventId");
CREATE INDEX "PaymentAttempt_invoiceId_provider_status_idx"
  ON "PaymentAttempt"("invoiceId", "provider", "status");
CREATE INDEX "PaymentAttempt_provider_providerSessionId_idx"
  ON "PaymentAttempt"("provider", "providerSessionId");
CREATE INDEX "PaymentEvent_attemptId_createdAt_idx"
  ON "PaymentEvent"("attemptId", "createdAt");
CREATE INDEX "Payment_attemptId_idx" ON "Payment"("attemptId");

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent"
  ADD CONSTRAINT "PaymentEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
