ALTER TABLE "business_records"
  ADD COLUMN "template_snapshot" JSONB,
  ADD COLUMN "source_snapshot" JSONB,
  ADD COLUMN "confirmation_snapshot" JSONB;

UPDATE "business_records"
SET "template_snapshot" = jsonb_build_object(
  'schemaVersion', 1,
  'templateId', "template_id",
  'version', "template_version",
  'legacyBackfill', true
)
WHERE "template_snapshot" IS NULL;

UPDATE "business_records"
SET "source_snapshot" = jsonb_build_object(
  'schemaVersion', 1,
  'sourceType', "source_type"::text,
  'sourceId', "source_id",
  'importTaskId', "import_task_id",
  'legacyBackfill', true
)
WHERE "source_snapshot" IS NULL;

UPDATE "business_records"
SET "confirmation_snapshot" = jsonb_build_object(
  'schemaVersion', 1,
  'projectId', "project_id",
  'templateId', "template_id",
  'templateVersion', "template_version",
  'recordType', "record_type"::text,
  'accountingDirection', "accounting_direction"::text,
  'recordDate', to_char("record_date" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
  'amount', "amount"::text,
  'category', "category",
  'sourceType', "source_type"::text,
  'sourceId', "source_id",
  'confirmedAt', "confirmed_at",
  'confirmedBy', "confirmed_by",
  'legacyBackfill', true
)
WHERE "status" = 'confirmed' AND "confirmation_snapshot" IS NULL;
