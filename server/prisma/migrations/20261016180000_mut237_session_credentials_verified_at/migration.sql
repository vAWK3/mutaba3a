-- MUT-237 fix: a session's own password change must not sign that session out.
-- The session middleware compared users."passwordChangedAt" with sessions."createdAt", so the session that
-- changed the password (kept live on purpose) failed the check on its next request. It now compares with
-- "credentialsVerifiedAt": set at sign-in, re-stamped on the kept session by POST /v1/me/password.
-- Backfill from "createdAt", which is exactly what the check compared until now, so no live session changes state.
ALTER TABLE "sessions" ADD COLUMN "credentialsVerifiedAt" TIMESTAMP(3);
UPDATE "sessions" SET "credentialsVerifiedAt" = "createdAt";
ALTER TABLE "sessions" ALTER COLUMN "credentialsVerifiedAt" SET NOT NULL;
