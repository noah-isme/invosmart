-- Workspace-scoped API keys. Raw secrets are never persisted; the application
-- stores only a SHA-256 digest and returns the generated token once.

CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_key_prefix"
  ON "ApiKey"("prefix");
CREATE INDEX IF NOT EXISTS "ApiKey_organizationId_revokedAt_idx"
  ON "ApiKey"("organizationId", "revokedAt");
CREATE INDEX IF NOT EXISTS "ApiKey_organizationId_createdAt_idx"
  ON "ApiKey"("organizationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_organizationId_fkey') THEN
    ALTER TABLE "ApiKey"
      ADD CONSTRAINT "ApiKey_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_createdById_fkey') THEN
    ALTER TABLE "ApiKey"
      ADD CONSTRAINT "ApiKey_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
