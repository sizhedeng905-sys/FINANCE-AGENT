CREATE TYPE "RecordSourceType" AS ENUM ('manual', 'excel', 'ocr', 'work_order');

CREATE TYPE "BusinessRecordStatus" AS ENUM ('draft', 'pending_confirm', 'confirmed', 'rejected');

CREATE TABLE "business_records" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "record_type" "DataRecordType" NOT NULL,
    "record_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "category" TEXT,
    "sub_category" TEXT,
    "description" TEXT,
    "source_type" "RecordSourceType" NOT NULL DEFAULT 'manual',
    "source_id" TEXT NOT NULL DEFAULT 'manual',
    "status" "BusinessRecordStatus" NOT NULL DEFAULT 'pending_confirm',
    "attachments" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,

    CONSTRAINT "business_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "record_values" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "value_text" TEXT,
    "value_number" DECIMAL(18,4),
    "value_date" TIMESTAMP(3),
    "value_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_username" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_records_project_id_idx" ON "business_records"("project_id");

CREATE INDEX "business_records_template_id_idx" ON "business_records"("template_id");

CREATE INDEX "business_records_status_idx" ON "business_records"("status");

CREATE INDEX "business_records_record_date_idx" ON "business_records"("record_date");

CREATE UNIQUE INDEX "record_values_record_id_field_id_key" ON "record_values"("record_id", "field_id");

CREATE INDEX "record_values_field_id_idx" ON "record_values"("field_id");

CREATE INDEX "ledger_events_aggregate_type_aggregate_id_idx" ON "ledger_events"("aggregate_type", "aggregate_id");

CREATE INDEX "ledger_events_event_type_idx" ON "ledger_events"("event_type");

ALTER TABLE "business_records" ADD CONSTRAINT "business_records_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_records" ADD CONSTRAINT "business_records_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "record_values" ADD CONSTRAINT "record_values_record_id_fkey"
FOREIGN KEY ("record_id") REFERENCES "business_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "record_values" ADD CONSTRAINT "record_values_field_id_fkey"
FOREIGN KEY ("field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
