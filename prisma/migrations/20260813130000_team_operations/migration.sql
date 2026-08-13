-- Team operations: one-time workspace invitations, encrypted notification
-- endpoint configuration, and idempotent invoice reminder occurrences.

CREATE TABLE IF NOT EXISTS "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkspaceNotificationEndpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceNotificationEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceReminderRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "channels" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvoiceReminderRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceReminderOccurrence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvoiceReminderOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceInvitation_tokenHash_key"
  ON "WorkspaceInvitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "WorkspaceInvitation_organizationId_email_idx"
  ON "WorkspaceInvitation"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "WorkspaceInvitation_organizationId_expiresAt_idx"
  ON "WorkspaceInvitation"("organizationId", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceNotificationEndpoint_organizationId_type_key"
  ON "WorkspaceNotificationEndpoint"("organizationId", "type");
CREATE INDEX IF NOT EXISTS "WorkspaceNotificationEndpoint_organizationId_enabled_idx"
  ON "WorkspaceNotificationEndpoint"("organizationId", "enabled");

CREATE INDEX IF NOT EXISTS "InvoiceReminderRule_organizationId_enabled_idx"
  ON "InvoiceReminderRule"("organizationId", "enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceReminderOccurrence_occurrenceKey_key"
  ON "InvoiceReminderOccurrence"("occurrenceKey");
CREATE INDEX IF NOT EXISTS "InvoiceReminderOccurrence_organizationId_scheduledAt_status_idx"
  ON "InvoiceReminderOccurrence"("organizationId", "scheduledAt", "status");
CREATE INDEX IF NOT EXISTS "InvoiceReminderOccurrence_invoiceId_ruleId_idx"
  ON "InvoiceReminderOccurrence"("invoiceId", "ruleId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceInvitation_organizationId_fkey') THEN
    ALTER TABLE "WorkspaceInvitation"
      ADD CONSTRAINT "WorkspaceInvitation_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceInvitation_invitedById_fkey') THEN
    ALTER TABLE "WorkspaceInvitation"
      ADD CONSTRAINT "WorkspaceInvitation_invitedById_fkey"
      FOREIGN KEY ("invitedById") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceNotificationEndpoint_organizationId_fkey') THEN
    ALTER TABLE "WorkspaceNotificationEndpoint"
      ADD CONSTRAINT "WorkspaceNotificationEndpoint_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceReminderRule_organizationId_fkey') THEN
    ALTER TABLE "InvoiceReminderRule"
      ADD CONSTRAINT "InvoiceReminderRule_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceReminderOccurrence_organizationId_fkey') THEN
    ALTER TABLE "InvoiceReminderOccurrence"
      ADD CONSTRAINT "InvoiceReminderOccurrence_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceReminderOccurrence_invoiceId_fkey') THEN
    ALTER TABLE "InvoiceReminderOccurrence"
      ADD CONSTRAINT "InvoiceReminderOccurrence_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceReminderOccurrence_ruleId_fkey') THEN
    ALTER TABLE "InvoiceReminderOccurrence"
      ADD CONSTRAINT "InvoiceReminderOccurrence_ruleId_fkey"
      FOREIGN KEY ("ruleId") REFERENCES "InvoiceReminderRule"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
