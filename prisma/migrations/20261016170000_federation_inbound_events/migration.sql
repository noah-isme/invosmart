-- Additive: new table only. Reversible with: DROP TABLE "FederationInboundEvent";
-- CreateTable
CREATE TABLE "FederationInboundEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "signatureAlgorithm" TEXT NOT NULL,
    "signatureHash" TEXT NOT NULL,
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted" BOOLEAN NOT NULL,

    CONSTRAINT "FederationInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FederationInboundEvent_signatureHash_key" ON "FederationInboundEvent"("signatureHash");

-- CreateIndex
CREATE INDEX "FederationInboundEvent_eventId_idx" ON "FederationInboundEvent"("eventId");

-- CreateIndex
CREATE INDEX "FederationInboundEvent_tenantId_receivedAt_idx" ON "FederationInboundEvent"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "FederationInboundEvent_receivedAt_idx" ON "FederationInboundEvent"("receivedAt");

