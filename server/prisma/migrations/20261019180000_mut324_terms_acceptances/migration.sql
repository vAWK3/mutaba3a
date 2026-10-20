-- MUT-324 (ADR-102): terms of service acceptances. Purely additive. The userId foreign key cascades on delete
-- by the owner's choice (D3): closing an account (MUT-333) removes the record of its agreement too.

-- CreateEnum
CREATE TYPE "TermsSurface" AS ENUM ('portal', 'phone');

-- CreateTable
CREATE TABLE "terms_acceptances" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" VARCHAR(10) NOT NULL,
    "locale" VARCHAR(5) NOT NULL,
    "textSha256" CHAR(64) NOT NULL,
    "surface" "TermsSurface" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terms_acceptances_userId_version_key" ON "terms_acceptances"("userId", "version");

-- AddForeignKey
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

