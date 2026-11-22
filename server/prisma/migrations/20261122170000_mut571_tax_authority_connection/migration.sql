-- MUT-571: a profile's connection to the Tax Authority's Open API. Tokens are sealed (AES-256-GCM) before they get here.
CREATE TABLE "tax_authority_connections" (
    "organizationId" UUID NOT NULL,
    "environment" VARCHAR(16) NOT NULL,
    "accessTokenSealed" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenSealed" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "connectedByUserId" UUID NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_authority_connections_pkey" PRIMARY KEY ("organizationId")
);
