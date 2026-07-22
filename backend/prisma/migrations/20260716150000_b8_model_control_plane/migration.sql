ALTER TABLE "ocr_tasks"
  ADD COLUMN "provider_config_snapshot" JSONB,
  ADD COLUMN "provider_config_hash" TEXT;

ALTER TABLE "ai_call_logs"
  ADD COLUMN "deployment_id" TEXT,
  ADD COLUMN "model_version" TEXT,
  ADD COLUMN "provider_config_snapshot" JSONB,
  ADD COLUMN "provider_config_hash" TEXT,
  ADD COLUMN "secret_ref" TEXT;

CREATE INDEX "ai_call_logs_deployment_id_created_at_idx"
  ON "ai_call_logs"("deployment_id", "created_at");

ALTER TABLE "ai_call_logs"
  ADD CONSTRAINT "ai_call_logs_deployment_id_fkey"
  FOREIGN KEY ("deployment_id") REFERENCES "model_deployments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
