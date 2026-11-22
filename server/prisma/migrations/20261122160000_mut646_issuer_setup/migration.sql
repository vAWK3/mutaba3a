-- MUT-646: invoicing setup. The defaults printed on new documents, the setup's own progress, and the logos (append-only).
ALTER TABLE "issuer_details" DROP COLUMN "logoAttachmentId",
ADD COLUMN "defaultLanguage" VARCHAR(2) NOT NULL DEFAULT 'he',
ADD COLUMN "paymentTermsDays" INTEGER,
ADD COLUMN "bankDetails" TEXT,
ADD COLUMN "footerNote" TEXT;

-- CreateTable
CREATE TABLE "issuing_setup" (
    "organizationId" UUID NOT NULL,
    "logoId" UUID,
    "numberingAnsweredAt" TIMESTAMP(3),
    "introSeenAt" TIMESTAMP(3),
    "defaultsSavedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issuing_setup_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "issuer_logos" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contentType" VARCHAR(10) NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issuer_logos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issuer_logos_organizationId_idx" ON "issuer_logos"("organizationId");
