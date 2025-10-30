-- CreateTable
CREATE TABLE "AgentEventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceAgent" TEXT NOT NULL,
    "targetAgent" TEXT,
    "priority" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "recommendationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AgentEventLog_traceId_idx" ON "AgentEventLog"("traceId");

-- CreateIndex
CREATE INDEX "AgentEventLog_recommendationId_idx" ON "AgentEventLog"("recommendationId");
