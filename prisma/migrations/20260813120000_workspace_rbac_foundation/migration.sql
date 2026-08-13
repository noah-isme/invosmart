-- Workspace and membership foundation.
--
-- The repository contains older migrations that predate the Client table and
-- several invoice columns now present in schema.prisma.  The guarded Client
-- creation below keeps a fresh migration chain usable while remaining a no-op
-- for databases that already have the table.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceRole') THEN
    CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "fontFamily" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'IDR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "activeOrganizationId" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- Client was introduced in schema.prisma before it received a checked-in
-- migration.  Create its current minimum shape only when it is absent.
CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "company" TEXT,
    "taxId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

ALTER TABLE "InvoiceTemplate"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- Older baseline migrations also omitted the optional Invoice -> Client
-- column.  Adding it here is harmless for current databases and lets the
-- workspace foreign key be applied consistently.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT;

-- Every existing user receives one deterministic personal workspace.  The
-- deterministic IDs make this block safe to rerun during staging recovery.
INSERT INTO "Organization" ("id", "name", "defaultCurrency", "createdAt", "updatedAt")
SELECT
  'personal_' || md5('organization:' || u."id"),
  COALESCE(NULLIF(BTRIM(u."name"), ''), split_part(u."email", '@', 1), 'Personal Workspace'),
  'IDR',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Membership" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
SELECT
  'membership_' || md5('owner:' || u."id"),
  'personal_' || md5('organization:' || u."id"),
  u."id",
  'OWNER',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT ("organizationId", "userId") DO NOTHING;

UPDATE "User" u
SET "activeOrganizationId" = 'personal_' || md5('organization:' || u."id")
WHERE "activeOrganizationId" IS NULL;

UPDATE "Invoice" i
SET "organizationId" = m."organizationId"
FROM "Membership" m
WHERE i."userId" = m."userId"
  AND i."organizationId" IS NULL;

UPDATE "Client" c
SET "organizationId" = m."organizationId"
FROM "Membership" m
WHERE c."userId" = m."userId"
  AND c."organizationId" IS NULL;

UPDATE "InvoiceTemplate" t
SET "organizationId" = m."organizationId"
FROM "Membership" m
WHERE t."userId" = m."userId"
  AND t."organizationId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Membership_organizationId_userId_key"
  ON "Membership"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX IF NOT EXISTS "Membership_organizationId_role_idx"
  ON "Membership"("organizationId", "role");
CREATE INDEX IF NOT EXISTS "Organization_createdAt_idx" ON "Organization"("createdAt");
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_createdAt_idx"
  ON "Invoice"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Client_organizationId_idx" ON "Client"("organizationId");
CREATE INDEX IF NOT EXISTS "InvoiceTemplate_organizationId_idx"
  ON "InvoiceTemplate"("organizationId");

-- Invoice numbers are unique within a workspace.  Existing invoice numbers
-- remain valid because all existing rows were backfilled above.
DROP INDEX IF EXISTS "Invoice_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_organization_number"
  ON "Invoice"("organizationId", "number");

CREATE UNIQUE INDEX IF NOT EXISTS "client_organization_email"
  ON "Client"("organizationId", "email");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Membership_organizationId_fkey') THEN
    ALTER TABLE "Membership"
      ADD CONSTRAINT "Membership_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Membership_userId_fkey') THEN
    ALTER TABLE "Membership"
      ADD CONSTRAINT "Membership_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_organizationId_fkey') THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT "Invoice_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Client_organizationId_fkey') THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceTemplate_organizationId_fkey') THEN
    ALTER TABLE "InvoiceTemplate"
      ADD CONSTRAINT "InvoiceTemplate_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
