-- MUT-115 (ADR-190): passkeys. Two new tables and one nullable column; no backfill.

-- 1. A person's WebAuthn credentials. Deleted with the person (and explicitly by the account purge, MUT-333).
CREATE TABLE "passkeys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" VARCHAR(1366) NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "signCount" BIGINT NOT NULL,
    "transports" TEXT[],
    "deviceType" VARCHAR(16) NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "aaguid" VARCHAR(36) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "passkeys_signCount_check" CHECK ("signCount" >= 0 AND "signCount" <= 4294967295),
    CONSTRAINT "passkeys_deviceType_check" CHECK ("deviceType" IN ('singleDevice', 'multiDevice'))
);
CREATE UNIQUE INDEX "passkeys_credentialId_key" ON "passkeys"("credentialId");
CREATE INDEX "passkeys_userId_idx" ON "passkeys"("userId");
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. D5: single-use challenges, 5 minutes, pruned by the server's hourly timer.
CREATE TYPE "WebauthnChallengePurpose" AS ENUM ('creation', 'authentication');
CREATE TABLE "webauthn_challenges" (
    "id" UUID NOT NULL,
    "challenge" VARCHAR(128) NOT NULL,
    "purpose" "WebauthnChallengePurpose" NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id"),
    -- A creation challenge always names its person; a sign-in challenge never does.
    CONSTRAINT "webauthn_challenges_user_check" CHECK (("purpose" = 'creation') = ("userId" IS NOT NULL))
);
CREATE INDEX "webauthn_challenges_expiresAt_idx" ON "webauthn_challenges"("expiresAt");
CREATE INDEX "webauthn_challenges_userId_idx" ON "webauthn_challenges"("userId");
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. A2/D6: the passkey that opened a session, so removing the passkey can revoke it. SET NULL keeps the revoked row.
ALTER TABLE "sessions" ADD COLUMN "passkeyId" UUID;
CREATE INDEX "sessions_passkeyId_idx" ON "sessions"("passkeyId");
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_passkeyId_fkey" FOREIGN KEY ("passkeyId") REFERENCES "passkeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
