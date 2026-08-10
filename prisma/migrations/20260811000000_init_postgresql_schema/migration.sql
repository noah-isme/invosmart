-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'UNPAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "OptimizationStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ALLOWED', 'REVIEW', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ExperimentAxis" AS ENUM ('HOOK', 'CAPTION', 'CTA', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('running', 'paused', 'stopped', 'completed');

-- CreateEnum
CREATE TYPE "AutoActionType" AS ENUM ('AUTOPUBLISH', 'SCHEDULE_UPDATE', 'AUTO_REVERT', 'AUTO_CTA_TUNE');

-- CreateEnum
CREATE TYPE "AutoActionStatus" AS ENUM ('applied', 'reverted', 'failed');

-- CreateEnum
CREATE TYPE "ReceiptPosition" AS ENUM ('bottom_left', 'bottom_right', 'center');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "fontFamily" TEXT,
    "brandingSyncWithTheme" BOOLEAN NOT NULL DEFAULT false,
    "useThemeForPdf" BOOLEAN NOT NULL DEFAULT false,
    "themePrimary" TEXT DEFAULT '#6366F1',
    "themeAccent" TEXT DEFAULT '#22D3EE',
    "themeMode" TEXT DEFAULT 'dark',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationLog" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "status" "OptimizationStatus" NOT NULL DEFAULT 'PENDING',
    "actor" TEXT NOT NULL DEFAULT 'system',
    "notes" TEXT,
    "rollback" BOOLEAN NOT NULL DEFAULT false,
    "deltaImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evalConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "policyStatus" "PolicyStatus" NOT NULL DEFAULT 'ALLOWED',
    "policyReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExplanationLog" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "context" TEXT,
    "dataBasis" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "policyStatus" "PolicyStatus" NOT NULL DEFAULT 'ALLOWED',
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ExplanationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProfile" (
    "route" TEXT NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "totalEvaluations" INTEGER NOT NULL DEFAULT 0,
    "lastLcpP95" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastInpP95" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastApiLatencyP95" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastErrorRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastEval" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningProfile_pkey" PRIMARY KEY ("route")
);

-- CreateTable
CREATE TABLE "AgentEventLog" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceAgent" TEXT NOT NULL,
    "targetAgent" TEXT,
    "priority" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "recommendationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPriority" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "rationale" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPriority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryLog" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "traceId" TEXT,
    "trustScoreBefore" DOUBLE PRECISION,
    "trustScoreAfter" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationMetrics" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "participants" INTEGER NOT NULL,
    "averageTrust" DOUBLE PRECISION NOT NULL,
    "medianTrust" DOUBLE PRECISION NOT NULL,
    "trustStdDeviation" DOUBLE PRECISION NOT NULL,
    "highestTenant" TEXT,
    "highestTrust" DOUBLE PRECISION,
    "lowestTenant" TEXT,
    "lowestTrust" DOUBLE PRECISION,
    "averageLatencyMs" DOUBLE PRECISION,
    "aggregatedPriorities" JSONB NOT NULL,
    "summary" TEXT,
    "networkHealth" TEXT NOT NULL DEFAULT 'healthy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FederationMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentExperiment" (
    "id" SERIAL NOT NULL,
    "organizationId" TEXT,
    "contentId" INTEGER NOT NULL,
    "axis" "ExperimentAxis" NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'running',
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "winnerVariantId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVariant" (
    "id" SERIAL NOT NULL,
    "experimentId" INTEGER NOT NULL,
    "variantKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "aiExplanation" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantMetric" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "dwellMs" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAutoAction" (
    "id" SERIAL NOT NULL,
    "organizationId" TEXT,
    "actionType" "AutoActionType" NOT NULL,
    "contentId" INTEGER,
    "experimentId" INTEGER,
    "variantId" INTEGER,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" "AutoActionStatus" NOT NULL DEFAULT 'applied',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAutoAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalContentSignal" (
    "id" SERIAL NOT NULL,
    "organizationId" TEXT,
    "axis" "ExperimentAxis" NOT NULL,
    "window" TEXT NOT NULL,
    "signal" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalContentSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paidAmount" INTEGER NOT NULL,
    "paidCurrency" TEXT NOT NULL DEFAULT 'IDR',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "verifyToken" VARCHAR(64) NOT NULL,
    "positionPreset" "ReceiptPosition" NOT NULL,
    "stampCompanySealEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stampPaidEnabled" BOOLEAN NOT NULL DEFAULT true,
    "signatureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAuditLog" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "AgentEventLog_traceId_idx" ON "AgentEventLog"("traceId");

-- CreateIndex
CREATE INDEX "AgentEventLog_recommendationId_idx" ON "AgentEventLog"("recommendationId");

-- CreateIndex
CREATE INDEX "AgentPriority_agent_idx" ON "AgentPriority"("agent");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPriority_agent_key" ON "AgentPriority"("agent");

-- CreateIndex
CREATE INDEX "RecoveryLog_agent_idx" ON "RecoveryLog"("agent");

-- CreateIndex
CREATE INDEX "RecoveryLog_createdAt_idx" ON "RecoveryLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FederationMetrics_cycleId_tenantId_key" ON "FederationMetrics"("cycleId", "tenantId");

-- CreateIndex
CREATE INDEX "ContentExperiment_organizationId_contentId_axis_idx" ON "ContentExperiment"("organizationId", "contentId", "axis");

-- CreateIndex
CREATE INDEX "ContentVariant_experimentId_idx" ON "ContentVariant"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVariant_experimentId_variantKey_key" ON "ContentVariant"("experimentId", "variantKey");

-- CreateIndex
CREATE INDEX "VariantMetric_variantId_idx" ON "VariantMetric"("variantId");

-- CreateIndex
CREATE INDEX "AiAutoAction_organizationId_actionType_createdAt_idx" ON "AiAutoAction"("organizationId", "actionType", "createdAt");

-- CreateIndex
CREATE INDEX "GlobalContentSignal_organizationId_axis_window_idx" ON "GlobalContentSignal"("organizationId", "axis", "window");

-- CreateIndex
CREATE UNIQUE INDEX "organizationId_axis_window" ON "GlobalContentSignal"("organizationId", "axis", "window");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNo_key" ON "Receipt"("receiptNo");

-- CreateIndex
CREATE INDEX "Receipt_paymentId_idx" ON "Receipt"("paymentId");

-- CreateIndex
CREATE INDEX "ReceiptAuditLog_receiptId_idx" ON "ReceiptAuditLog"("receiptId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExplanationLog" ADD CONSTRAINT "ExplanationLog_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "OptimizationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentExperiment" ADD CONSTRAINT "ContentExperiment_winnerVariantId_fkey" FOREIGN KEY ("winnerVariantId") REFERENCES "ContentVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ContentExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMetric" ADD CONSTRAINT "VariantMetric_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ContentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAutoAction" ADD CONSTRAINT "AiAutoAction_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ContentExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAutoAction" ADD CONSTRAINT "AiAutoAction_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ContentVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAuditLog" ADD CONSTRAINT "ReceiptAuditLog_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
