-- MUT-596: whether an account's password is one its person chose (false only for an account Sign in with Malafat
-- created with a random password nobody holds). Existing accounts: true. Additive.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordChosen" BOOLEAN NOT NULL DEFAULT true;

