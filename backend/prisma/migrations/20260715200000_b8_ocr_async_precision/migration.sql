ALTER TABLE "ocr_tasks"
  ADD COLUMN "queued_at" TIMESTAMP(3),
  ADD COLUMN "run_requested_by" TEXT,
  ADD COLUMN "run_request_id" TEXT;

ALTER TABLE "ocr_attempts"
  ADD COLUMN "provider_config_snapshot" JSONB,
  ADD COLUMN "provider_config_hash" TEXT,
  ADD COLUMN "secret_ref" TEXT;

CREATE INDEX "ocr_tasks_status_queued_at_idx" ON "ocr_tasks"("status", "queued_at");
