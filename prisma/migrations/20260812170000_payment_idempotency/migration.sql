-- Add an update timestamp for operational reconciliation and ensure a gateway
-- notification can only create one payment record per provider/external ID.
ALTER TABLE "Payment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "payment_gateway_provider_external_id"
ON "Payment"("gatewayProvider", "gatewayPaymentId");
