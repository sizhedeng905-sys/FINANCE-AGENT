ALTER TYPE "ImportTaskStatus" ADD VALUE 'confirming';
ALTER TYPE "ImportTaskStatus" ADD VALUE 'confirmation_failed';

ALTER TABLE "import_tasks"
ADD COLUMN "confirm_requested_by" TEXT,
ADD COLUMN "confirmation_total_rows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmation_processed_rows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmation_success_rows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmation_error_rows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmation_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmation_started_at" TIMESTAMP(3);

ALTER TABLE "import_rows"
ADD COLUMN "confirmation_processed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "uq_business_records_import_source"
ON "business_records"("import_task_id", "source_id");
