CREATE TYPE "RecordDataLayer" AS ENUM ('actual', 'reconciliation', 'budget');

ALTER TABLE "templates"
  ADD COLUMN "data_layer" "RecordDataLayer" NOT NULL DEFAULT 'actual';

ALTER TABLE "business_records"
  ADD COLUMN "data_layer" "RecordDataLayer" NOT NULL DEFAULT 'actual';

CREATE INDEX "business_records_data_layer_status_record_date_idx"
  ON "business_records"("data_layer", "status", "record_date");
