-- MUT-595 (ADR-254 D1, D4, D8): Sign in with Malafat's single-use round trips. Additive only.

-- CreateTable
CREATE TABLE "malafat_sign_ins" (
    "id" UUID NOT NULL,
    "stateDigest" VARCHAR(64) NOT NULL,
    "codeVerifier" VARCHAR(128) NOT NULL,
    "tenantSlug" VARCHAR(63) NOT NULL,
    "client" VARCHAR(8) NOT NULL,
    "appChallenge" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "callbackAt" TIMESTAMP(3),
    "facts" JSONB,
    "outcome" VARCHAR(16),
    "userId" UUID,
    "resultDigest" VARCHAR(64),
    "resultExpiresAt" TIMESTAMP(3),
    "resultUsedAt" TIMESTAMP(3),
    "ticketDigest" VARCHAR(64),
    "ticketExpiresAt" TIMESTAMP(3),
    "linkProvenAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "malafat_sign_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "malafat_sign_ins_stateDigest_key" ON "malafat_sign_ins"("stateDigest");

-- CreateIndex
CREATE UNIQUE INDEX "malafat_sign_ins_resultDigest_key" ON "malafat_sign_ins"("resultDigest");

-- CreateIndex
CREATE UNIQUE INDEX "malafat_sign_ins_ticketDigest_key" ON "malafat_sign_ins"("ticketDigest");

-- CreateIndex
CREATE INDEX "malafat_sign_ins_expiresAt_idx" ON "malafat_sign_ins"("expiresAt");

-- CreateIndex
CREATE INDEX "malafat_sign_ins_userId_idx" ON "malafat_sign_ins"("userId");

-- AddForeignKey
ALTER TABLE "malafat_sign_ins" ADD CONSTRAINT "malafat_sign_ins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

