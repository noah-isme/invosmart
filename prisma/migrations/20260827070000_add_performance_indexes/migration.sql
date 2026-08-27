-- Performance indexes for v1 API query patterns.
-- All statements are additive and idempotent; safe for rolling deployments.

-- Invoice lookups by clientId (revenue aggregation, client detail page)
CREATE INDEX IF NOT EXISTS "Invoice_clientId_idx"
  ON "Invoice"("clientId");

-- Filtered + sorted invoice listings: WHERE organizationId AND status ORDER BY createdAt
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_status_createdAt_idx"
  ON "Invoice"("organizationId", "status", "createdAt");

-- Sorted client listings: WHERE organizationId ORDER BY createdAt DESC
CREATE INDEX IF NOT EXISTS "Client_organizationId_createdAt_idx"
  ON "Client"("organizationId", "createdAt");
