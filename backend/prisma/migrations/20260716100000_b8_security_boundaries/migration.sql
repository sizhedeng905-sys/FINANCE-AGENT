ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'auditor';

ALTER TABLE "raw_files"
  ALTER COLUMN "preview_status" SET DEFAULT 'untrusted_original';

UPDATE "raw_files"
SET "preview_status" = 'untrusted_original'
WHERE "preview_status" = 'original';
