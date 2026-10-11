-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('cookie', 'device');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "kind" "SessionKind" NOT NULL DEFAULT 'cookie';
