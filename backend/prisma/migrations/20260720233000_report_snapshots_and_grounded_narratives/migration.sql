CREATE TYPE "ReportSnapshotType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "ReportNarrativeStatus" AS ENUM ('NEEDS_FINANCE_REVIEW');

ALTER TABLE "business_records"
  ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY';

ALTER TABLE "business_records"
  ADD CONSTRAINT "business_records_currency_format_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE INDEX "business_records_currency_data_layer_status_record_date_idx"
  ON "business_records"("currency", "data_layer", "status", "record_date");

CREATE TABLE "report_snapshots" (
  "id" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL DEFAULT 'report-snapshot/1.0',
  "report_type" "ReportSnapshotType" NOT NULL,
  "scope_type" TEXT NOT NULL,
  "project_ids" JSONB NOT NULL DEFAULT '[]',
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end_exclusive" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "data_policy_json" JSONB NOT NULL,
  "metrics_json" JSONB NOT NULL,
  "breakdowns_json" JSONB NOT NULL DEFAULT '[]',
  "warnings_json" JSONB NOT NULL DEFAULT '[]',
  "query_version" TEXT NOT NULL,
  "data_watermark" TEXT NOT NULL,
  "source_digest" VARCHAR(64) NOT NULL,
  "source_count" INTEGER NOT NULL,
  "canonicalization_version" TEXT NOT NULL,
  "snapshot_hash" VARCHAR(64) NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "retention_class" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_snapshots_period_check" CHECK ("period_start" < "period_end_exclusive"),
  CONSTRAINT "report_snapshots_source_count_check" CHECK ("source_count" >= 0),
  CONSTRAINT "report_snapshots_source_digest_check" CHECK ("source_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "report_snapshots_snapshot_hash_check" CHECK ("snapshot_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "report_snapshots_snapshot_hash_key" ON "report_snapshots"("snapshot_hash");
CREATE INDEX "report_snapshots_report_type_period_start_period_end_exclusive_idx"
  ON "report_snapshots"("report_type", "period_start", "period_end_exclusive");
CREATE INDEX "report_snapshots_created_by_created_at_idx" ON "report_snapshots"("created_by", "created_at");
CREATE INDEX "report_snapshots_source_digest_idx" ON "report_snapshots"("source_digest");

CREATE TABLE "report_snapshot_sources" (
  "id" BIGSERIAL NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "record_version" INTEGER NOT NULL,
  "record_hash" VARCHAR(64) NOT NULL,
  "project_id" TEXT NOT NULL,
  "record_date" TIMESTAMP(3) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "accounting_direction" "AccountingDirection" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,

  CONSTRAINT "report_snapshot_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_snapshot_sources_record_version_check" CHECK ("record_version" > 0),
  CONSTRAINT "report_snapshot_sources_record_hash_check" CHECK ("record_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "report_snapshot_sources_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "report_snapshot_sources_snapshot_id_record_id_key"
  ON "report_snapshot_sources"("snapshot_id", "record_id");
CREATE INDEX "report_snapshot_sources_record_id_idx" ON "report_snapshot_sources"("record_id");
CREATE INDEX "report_snapshot_sources_snapshot_id_project_id_currency_idx"
  ON "report_snapshot_sources"("snapshot_id", "project_id", "currency");

CREATE TABLE "report_narratives" (
  "id" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "ai_task_id" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL DEFAULT 'report-narrative/1.0',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "warning_paths" JSONB NOT NULL DEFAULT '[]',
  "decision" "ReportNarrativeStatus" NOT NULL DEFAULT 'NEEDS_FINANCE_REVIEW',
  "narrative_hash" VARCHAR(64) NOT NULL,
  "narrative_json" JSONB NOT NULL,
  "provider" TEXT NOT NULL,
  "model_name" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "version_vector_hash" VARCHAR(64) NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "report_narratives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_narratives_hash_check" CHECK ("narrative_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "report_narratives_version_vector_hash_check" CHECK ("version_vector_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "report_narratives_ai_task_id_key" ON "report_narratives"("ai_task_id");
CREATE UNIQUE INDEX "report_narratives_snapshot_id_narrative_hash_key"
  ON "report_narratives"("snapshot_id", "narrative_hash");
CREATE INDEX "report_narratives_snapshot_id_created_at_idx" ON "report_narratives"("snapshot_id", "created_at");
CREATE INDEX "report_narratives_created_by_created_at_idx" ON "report_narratives"("created_by", "created_at");

CREATE TABLE "ai_financial_claims" (
  "id" TEXT NOT NULL,
  "report_narrative_id" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "claim_type" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "source_path" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "source_value_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_financial_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_financial_claims_source_value_hash_check" CHECK ("source_value_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "ai_financial_claims_report_narrative_id_claim_id_key"
  ON "ai_financial_claims"("report_narrative_id", "claim_id");
CREATE INDEX "ai_financial_claims_report_narrative_id_source_path_idx"
  ON "ai_financial_claims"("report_narrative_id", "source_path");

ALTER TABLE "report_snapshots"
  ADD CONSTRAINT "report_snapshots_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_snapshot_sources"
  ADD CONSTRAINT "report_snapshot_sources_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "report_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_snapshot_sources"
  ADD CONSTRAINT "report_snapshot_sources_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "business_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_narratives"
  ADD CONSTRAINT "report_narratives_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "report_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_narratives"
  ADD CONSTRAINT "report_narratives_ai_task_id_fkey"
  FOREIGN KEY ("ai_task_id") REFERENCES "ai_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_narratives"
  ADD CONSTRAINT "report_narratives_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_financial_claims"
  ADD CONSTRAINT "ai_financial_claims_report_narrative_id_fkey"
  FOREIGN KEY ("report_narrative_id") REFERENCES "report_narratives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_report_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'immutable report audit rows cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "report_snapshots_immutable"
  BEFORE UPDATE OR DELETE ON "report_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "prevent_report_audit_mutation"();

CREATE TRIGGER "report_snapshot_sources_immutable"
  BEFORE UPDATE OR DELETE ON "report_snapshot_sources"
  FOR EACH ROW EXECUTE FUNCTION "prevent_report_audit_mutation"();

CREATE TRIGGER "report_narratives_immutable"
  BEFORE UPDATE OR DELETE ON "report_narratives"
  FOR EACH ROW EXECUTE FUNCTION "prevent_report_audit_mutation"();

CREATE TRIGGER "ai_financial_claims_immutable"
  BEFORE UPDATE OR DELETE ON "ai_financial_claims"
  FOR EACH ROW EXECUTE FUNCTION "prevent_report_audit_mutation"();
