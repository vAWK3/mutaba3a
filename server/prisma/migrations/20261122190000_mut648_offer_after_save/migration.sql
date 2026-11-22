-- MUT-648: after saving an Owed or a Received, offer to issue its document (on by default).
ALTER TABLE "issuer_details" ADD COLUMN "offerAfterSave" BOOLEAN NOT NULL DEFAULT true;
