-- Expand-only reminder delivery state. Existing occurrence rows remain valid;
-- delivery rows are materialized by the dispatcher with a unique
-- (occurrenceId, channel) key so retries and concurrent cron invocations are
-- idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvoiceReminderDeliveryStatus') THEN
    CREATE TYPE "InvoiceReminderDeliveryStatus" AS ENUM (
      'PENDING', 'PROCESSING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "InvoiceReminderDelivery" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "InvoiceReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvoiceReminderDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_reminder_delivery_occurrence_channel"
  ON "InvoiceReminderDelivery"("occurrenceId", "channel");
CREATE INDEX IF NOT EXISTS "InvoiceReminderDelivery_status_nextAttemptAt_idx"
  ON "InvoiceReminderDelivery"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "InvoiceReminderDelivery_occurrenceId_status_idx"
  ON "InvoiceReminderDelivery"("occurrenceId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceReminderDelivery_occurrenceId_fkey') THEN
    ALTER TABLE "InvoiceReminderDelivery"
      ADD CONSTRAINT "InvoiceReminderDelivery_occurrenceId_fkey"
      FOREIGN KEY ("occurrenceId") REFERENCES "InvoiceReminderOccurrence"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
