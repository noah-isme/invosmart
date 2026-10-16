-- Additive: new table only. Reversible with: DROP TABLE "CronLease";
-- CreateTable
CREATE TABLE "CronLease" (
    "name" TEXT NOT NULL,
    "claimedUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronLease_pkey" PRIMARY KEY ("name")
);

