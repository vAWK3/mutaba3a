-- MUT-267 (ADR-094): expense groups and their keep/leave-out marks. Purely additive.

-- CreateTable
CREATE TABLE "expense_groups" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "startOn" VARCHAR(10) NOT NULL,
    "endOn" VARCHAR(10),
    "notes" TEXT,
    "createdByUserId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expense_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_group_overrides" (
    "groupId" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "mode" VARCHAR(8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_group_overrides_pkey" PRIMARY KEY ("groupId","expenseId")
);

-- CreateIndex
CREATE INDEX "expense_groups_organizationId_startOn_id_idx" ON "expense_groups"("organizationId", "startOn" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "expense_group_overrides_expenseId_idx" ON "expense_group_overrides"("expenseId");

-- AddForeignKey
ALTER TABLE "expense_groups" ADD CONSTRAINT "expense_groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_groups" ADD CONSTRAINT "expense_groups_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_group_overrides" ADD CONSTRAINT "expense_group_overrides_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "expense_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_group_overrides" ADD CONSTRAINT "expense_group_overrides_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_group_overrides" ADD CONSTRAINT "expense_group_overrides_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A mark is one of two words; anything else is a bug, not data.
ALTER TABLE "expense_group_overrides" ADD CONSTRAINT "expense_group_overrides_mode_check" CHECK ("mode" IN ('excluded', 'included'));
