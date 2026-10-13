-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "occurredOn" VARCHAR(10) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "toAmountMinor" BIGINT NOT NULL,
    "toCurrency" VARCHAR(3) NOT NULL,
    "notes" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversions_organizationId_occurredOn_id_idx" ON "conversions"("organizationId", "occurredOn" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
