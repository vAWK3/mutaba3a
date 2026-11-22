-- MUT-659 (Basel, 2026-11-22): server reading is for everyone, so `receipt_reading` is no longer a feature.
-- Revoke its open grants instead of deleting them, so the grant history stays.
UPDATE "user_feature_grants" SET "revokedAt" = NOW() WHERE "feature" = 'receipt_reading' AND "revokedAt" IS NULL;
