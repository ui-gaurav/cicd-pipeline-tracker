-- AlterTable: add deliveryId (idempotency key for X-GitHub-Delivery) and runId (for out-of-order upsert)
ALTER TABLE "Deployment" ADD COLUMN "deliveryId" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "runId" TEXT;

-- CreateIndex: unique on deliveryId so duplicate GitHub deliveries are rejected
CREATE UNIQUE INDEX "Deployment_deliveryId_key" ON "Deployment"("deliveryId");

-- CreateIndex: index on runId so out-of-order upserts are fast
CREATE INDEX "Deployment_runId_idx" ON "Deployment"("runId");
