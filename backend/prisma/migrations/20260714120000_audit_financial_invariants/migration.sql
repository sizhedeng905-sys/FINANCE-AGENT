CREATE TYPE "AccountingDirection" AS ENUM ('income', 'expense');

ALTER TABLE "templates"
  ADD COLUMN "accounting_direction" "AccountingDirection" NOT NULL DEFAULT 'expense',
  ADD COLUMN "primary_amount_field_id" TEXT,
  ADD COLUMN "primary_date_field_id" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "templates"
SET "accounting_direction" = CASE
  WHEN "record_type" = 'revenue' THEN 'income'::"AccountingDirection"
  ELSE 'expense'::"AccountingDirection"
END;

UPDATE "templates" AS t
SET "primary_amount_field_id" = (
  SELECT tf."field_id"
  FROM "template_fields" AS tf
  JOIN "field_definitions" AS f ON f."id" = tf."field_id"
  WHERE tf."template_id" = t."id"
    AND tf."is_visible" = TRUE
    AND f."is_active" = TRUE
    AND f."field_type" = 'money'
  ORDER BY
    CASE f."field_key"
      WHEN 'incomeAmount' THEN 0
      WHEN 'amount' THEN 1
      ELSE 2
    END,
    tf."display_order",
    tf."id"
  LIMIT 1
);

UPDATE "templates" AS t
SET "primary_date_field_id" = (
  SELECT tf."field_id"
  FROM "template_fields" AS tf
  JOIN "field_definitions" AS f ON f."id" = tf."field_id"
  WHERE tf."template_id" = t."id"
    AND tf."is_visible" = TRUE
    AND f."is_active" = TRUE
    AND f."field_type" = 'date'
  ORDER BY
    CASE f."field_key" WHEN 'date' THEN 0 ELSE 1 END,
    tf."display_order",
    tf."id"
  LIMIT 1
);

UPDATE "template_fields" AS tf
SET "is_required" = TRUE,
    "is_visible" = TRUE
FROM "templates" AS t
WHERE tf."template_id" = t."id"
  AND tf."field_id" IN (t."primary_amount_field_id", t."primary_date_field_id");

CREATE INDEX "templates_primary_amount_field_id_idx" ON "templates"("primary_amount_field_id");
CREATE INDEX "templates_primary_date_field_id_idx" ON "templates"("primary_date_field_id");

ALTER TABLE "templates"
  ADD CONSTRAINT "templates_primary_amount_field_id_fkey"
  FOREIGN KEY ("primary_amount_field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "templates_primary_date_field_id_fkey"
  FOREIGN KEY ("primary_date_field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_templates"
  ADD COLUMN "record_type" "DataRecordType";

UPDATE "project_templates" AS pt
SET "record_type" = t."record_type"
FROM "templates" AS t
WHERE t."id" = pt."template_id";

ALTER TABLE "project_templates"
  ALTER COLUMN "record_type" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "project_templates"
    WHERE "is_active" = TRUE
    GROUP BY "project_id", "record_type"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple active project templates exist for the same project and record type';
  END IF;
END $$;

CREATE INDEX "project_templates_project_id_record_type_idx"
  ON "project_templates"("project_id", "record_type");
CREATE UNIQUE INDEX "project_templates_active_record_type_key"
  ON "project_templates"("project_id", "record_type")
  WHERE "is_active" = TRUE;

ALTER TABLE "business_records"
  ADD COLUMN "accounting_direction" "AccountingDirection" NOT NULL DEFAULT 'expense',
  ADD COLUMN "template_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "business_records" AS br
SET "accounting_direction" = t."accounting_direction",
    "template_version" = t."version"
FROM "templates" AS t
WHERE t."id" = br."template_id";

UPDATE "business_records"
SET "confirmed_at" = NULL,
    "confirmed_by" = NULL
WHERE "status" <> 'confirmed';

UPDATE "business_records"
SET "voided_at" = NULL,
    "voided_by" = NULL
WHERE "status" <> 'rejected';

UPDATE "business_records"
SET "confirmed_at" = COALESCE("confirmed_at", "updated_at")
WHERE "status" = 'confirmed';

UPDATE "business_records"
SET "voided_at" = COALESCE("voided_at", "updated_at")
WHERE "status" = 'rejected';

ALTER TABLE "business_records"
  ADD CONSTRAINT "business_records_terminal_timestamps_check"
  CHECK (
    ("status" = 'confirmed' AND "confirmed_at" IS NOT NULL AND "voided_at" IS NULL)
    OR ("status" = 'rejected' AND "confirmed_at" IS NULL AND "voided_at" IS NOT NULL)
    OR ("status" IN ('draft', 'pending_confirm') AND "confirmed_at" IS NULL AND "voided_at" IS NULL)
  );

ALTER TABLE "work_orders"
  ADD COLUMN "template_id" TEXT,
  ADD COLUMN "template_version" INTEGER,
  ADD COLUMN "template_snapshot" JSONB,
  ADD COLUMN "submission_snapshot" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "submitted_at" TIMESTAMP(3);

UPDATE "work_orders" AS w
SET "template_id" = (
  SELECT pt."template_id"
  FROM "project_templates" AS pt
  JOIN "templates" AS t ON t."id" = pt."template_id"
  WHERE pt."project_id" = w."project_id"
    AND pt."is_active" = TRUE
    AND t."record_type" = CASE w."type"
      WHEN 'transport' THEN 'transport'::"DataRecordType"
      WHEN 'expense' THEN 'reimbursement'::"DataRecordType"
      ELSE 'other'::"DataRecordType"
    END
  LIMIT 1
),
"template_version" = (
  SELECT t."version"
  FROM "project_templates" AS pt
  JOIN "templates" AS t ON t."id" = pt."template_id"
  WHERE pt."project_id" = w."project_id"
    AND pt."is_active" = TRUE
    AND t."record_type" = CASE w."type"
      WHEN 'transport' THEN 'transport'::"DataRecordType"
      WHEN 'expense' THEN 'reimbursement'::"DataRecordType"
      ELSE 'other'::"DataRecordType"
    END
  LIMIT 1
);

UPDATE "work_orders"
SET "submitted_at" = "created_at"
WHERE "status" NOT IN ('draft', 'returned_for_supplement');

CREATE INDEX "work_orders_template_id_idx" ON "work_orders"("template_id");
ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_tasks"
  ADD COLUMN "template_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "template_snapshot" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lease_token" TEXT,
  ADD COLUMN "lease_until" TIMESTAMP(3);

ALTER TYPE "ImportTaskStatus" ADD VALUE IF NOT EXISTS 'parsing';
ALTER TYPE "ImportTaskStatus" ADD VALUE IF NOT EXISTS 'cancelled';

CREATE INDEX "import_tasks_status_lease_until_idx"
  ON "import_tasks"("status", "lease_until");

UPDATE "import_tasks" AS task
SET "template_version" = t."version"
FROM "templates" AS t
WHERE t."id" = task."template_id";

ALTER TABLE "ocr_tasks"
  ADD COLUMN "template_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "template_snapshot" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lease_token" TEXT,
  ADD COLUMN "lease_until" TIMESTAMP(3);

CREATE INDEX "ocr_tasks_status_lease_until_idx"
  ON "ocr_tasks"("status", "lease_until");

UPDATE "ocr_tasks" AS task
SET "template_version" = t."version"
FROM "templates" AS t
WHERE t."id" = task."template_id";

ALTER TABLE "ledger_events"
  ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "ledger_events_idempotency_key_key"
  ON "ledger_events"("idempotency_key");

ALTER TYPE "AnomalyStatus" ADD VALUE IF NOT EXISTS 'acknowledged';
ALTER TYPE "AnomalyStatus" ADD VALUE IF NOT EXISTS 'accepted_risk';
ALTER TYPE "AnomalyStatus" ADD VALUE IF NOT EXISTS 'false_positive';

ALTER TABLE "ai_anomalies"
  ADD COLUMN "handled_by_id" TEXT,
  ADD COLUMN "handled_by_name" TEXT,
  ADD COLUMN "handling_reason" TEXT,
  ADD COLUMN "handled_at" TIMESTAMP(3);
