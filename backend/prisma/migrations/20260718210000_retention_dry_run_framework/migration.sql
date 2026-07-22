CREATE TYPE "RetentionDataClass" AS ENUM (
  'ai_conversation_content',
  'ai_provider_payload',
  'ai_task_payload',
  'ocr_intermediate',
  'import_intermediate',
  'notification',
  'idempotency_response',
  'audit_event',
  'ledger_event'
);

CREATE TYPE "RetentionRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE "retention_runs" (
  "id" TEXT NOT NULL,
  "data_class" "RetentionDataClass" NOT NULL,
  "status" "RetentionRunStatus" NOT NULL DEFAULT 'queued',
  "dry_run" BOOLEAN NOT NULL DEFAULT true,
  "cutoff_at" TIMESTAMP(3) NOT NULL,
  "batch_size" INTEGER NOT NULL,
  "policy_version" TEXT NOT NULL DEFAULT 'retention-framework/1.0-pending-h14',
  "requested_by" TEXT,
  "requested_by_username" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "lease_token" TEXT,
  "lease_until" TIMESTAMP(3),
  "before_count" INTEGER NOT NULL DEFAULT 0,
  "after_count" INTEGER NOT NULL DEFAULT 0,
  "scanned_count" INTEGER NOT NULL DEFAULT 0,
  "eligible_count" INTEGER NOT NULL DEFAULT 0,
  "held_count" INTEGER NOT NULL DEFAULT 0,
  "protected_count" INTEGER NOT NULL DEFAULT 0,
  "deleted_count" INTEGER NOT NULL DEFAULT 0,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_runs_dry_run_only" CHECK ("dry_run" = true),
  CONSTRAINT "retention_runs_batch_size" CHECK ("batch_size" BETWEEN 1 AND 500),
  CONSTRAINT "retention_runs_max_attempts" CHECK ("max_attempts" BETWEEN 1 AND 10),
  CONSTRAINT "retention_runs_deleted_count_zero" CHECK ("deleted_count" = 0)
);

CREATE TABLE "retention_legal_holds" (
  "id" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_by_username" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "retention_legal_holds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "retention_runs_status_lease_until_idx"
  ON "retention_runs"("status", "lease_until");
CREATE INDEX "retention_runs_data_class_created_at_idx"
  ON "retention_runs"("data_class", "created_at");
CREATE UNIQUE INDEX "retention_legal_holds_resource_type_resource_id_key"
  ON "retention_legal_holds"("resource_type", "resource_id");
CREATE INDEX "retention_legal_holds_active_resource_type_idx"
  ON "retention_legal_holds"("active", "resource_type");

ALTER TABLE "retention_runs"
  ADD CONSTRAINT "retention_runs_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "retention_legal_holds"
  ADD CONSTRAINT "retention_legal_holds_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
