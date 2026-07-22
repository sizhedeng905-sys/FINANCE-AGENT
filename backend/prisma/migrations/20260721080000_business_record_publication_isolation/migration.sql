CREATE TYPE "BusinessRecordPublicationStatus" AS ENUM ('unpublished', 'published');

ALTER TABLE "business_records"
  ADD COLUMN "publication_status" "BusinessRecordPublicationStatus" NOT NULL DEFAULT 'published';

ALTER TABLE "business_records"
  ADD CONSTRAINT "business_records_unpublished_excel_source_check"
  CHECK (
    "publication_status" = 'published'
    OR (
      "import_task_id" IS NOT NULL
      AND "source_type" = 'excel'
    )
  );

CREATE INDEX "business_records_publication_status_project_id_created_at_idx"
  ON "business_records"("publication_status", "project_id", "created_at");

CREATE INDEX "business_records_publication_status_status_record_date_idx"
  ON "business_records"("publication_status", "status", "record_date");
