-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('INVOICE', 'RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING_UPLOAD', 'READY');

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "storageKey" TEXT NOT NULL,
    "customerId" UUID,
    "projectId" UUID,
    "paymentId" UUID,
    "invoiceNumber" TEXT,
    "invoiceDate" VARCHAR(10),
    "uploadedByKeyId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_organizationId_customerId_createdAt_idx" ON "attachments"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_organizationId_projectId_createdAt_idx" ON "attachments"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_organizationId_paymentId_createdAt_idx" ON "attachments"("organizationId", "paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_organizationId_entityType_entityId_createdAt_idx" ON "audit_events"("organizationId", "entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
