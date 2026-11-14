-- MUT-618 (ADR-256 D3): emailed sign-in codes. Additive only.

-- CreateTable
CREATE TABLE "sign_in_codes" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "userId" UUID,
    "codeDigest" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "sign_in_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sign_in_codes_email_createdAt_idx" ON "sign_in_codes"("email", "createdAt");

-- CreateIndex
CREATE INDEX "sign_in_codes_expiresAt_idx" ON "sign_in_codes"("expiresAt");

-- CreateIndex
CREATE INDEX "sign_in_codes_userId_idx" ON "sign_in_codes"("userId");

-- AddForeignKey
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
