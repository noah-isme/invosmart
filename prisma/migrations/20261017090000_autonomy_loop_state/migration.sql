-- Additive: new table only. Reversible with: DROP TABLE "AutonomyLoopState";
-- CreateTable
CREATE TABLE "AutonomyLoopState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "paused" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastIntervalMs" INTEGER,
    "lastConcurrency" INTEGER,
    "lastTelemetry" JSONB,
    "lastSummary" TEXT,
    "lastResult" JSONB,
    "claimedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutonomyLoopState_pkey" PRIMARY KEY ("id")
);

