/*
  Warnings:

  - A unique constraint covering the columns `[repositoryId,runId]` on the table `Deployment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Deployment_repositoryId_runId_key" ON "Deployment"("repositoryId", "runId");
