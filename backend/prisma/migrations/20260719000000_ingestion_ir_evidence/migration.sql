ALTER TABLE "import_tasks"
  ADD COLUMN "source_sha256" TEXT,
  ADD COLUMN "parser_input_sha256" TEXT,
  ADD COLUMN "ir_schema_version" TEXT,
  ADD COLUMN "parser_version" TEXT,
  ADD COLUMN "ir_hash" TEXT,
  ADD COLUMN "row_evidence_digest" TEXT;

ALTER TABLE "import_sheets"
  ADD COLUMN "stable_id" TEXT,
  ADD COLUMN "visibility" TEXT,
  ADD COLUMN "header_start_row_index" INTEGER,
  ADD COLUMN "selected_header_rows" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "merged_ranges" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "date_system" TEXT,
  ADD COLUMN "timezone" TEXT;

ALTER TABLE "import_columns"
  ADD COLUMN "source_column_id" TEXT,
  ADD COLUMN "column_letter" TEXT,
  ADD COLUMN "header_parts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "statistics_json" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "import_rows"
  ADD COLUMN "cell_evidence_json" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "evidence_hash" TEXT;

ALTER TABLE "ocr_tasks"
  ADD COLUMN "source_sha256" TEXT,
  ADD COLUMN "ir_schema_version" TEXT,
  ADD COLUMN "ir_hash" TEXT,
  ADD COLUMN "coordinate_version" TEXT,
  ADD COLUMN "preprocessing_version" TEXT,
  ADD COLUMN "normalized_ir_json" JSONB;

ALTER TABLE "import_tasks"
  ADD CONSTRAINT "import_tasks_evidence_hashes_format" CHECK (
    ("source_sha256" IS NULL OR "source_sha256" ~ '^[0-9a-f]{64}$')
    AND ("parser_input_sha256" IS NULL OR "parser_input_sha256" ~ '^[0-9a-f]{64}$')
    AND ("ir_hash" IS NULL OR "ir_hash" ~ '^[0-9a-f]{64}$')
    AND ("row_evidence_digest" IS NULL OR "row_evidence_digest" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "import_sheets"
  ADD CONSTRAINT "import_sheets_evidence_values" CHECK (
    ("visibility" IS NULL OR "visibility" IN ('visible', 'hidden', 'veryHidden'))
    AND ("date_system" IS NULL OR "date_system" IN ('1900', '1904'))
    AND ("timezone" IS NULL OR length("timezone") BETWEEN 1 AND 64)
  );

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_evidence_hash_format" CHECK (
    "evidence_hash" IS NULL OR "evidence_hash" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "ocr_tasks"
  ADD CONSTRAINT "ocr_tasks_ir_hashes_format" CHECK (
    ("source_sha256" IS NULL OR "source_sha256" ~ '^[0-9a-f]{64}$')
    AND ("ir_hash" IS NULL OR "ir_hash" ~ '^[0-9a-f]{64}$')
  );

CREATE INDEX "import_tasks_ir_hash_idx" ON "import_tasks"("ir_hash");
CREATE INDEX "import_rows_evidence_hash_idx" ON "import_rows"("evidence_hash");
CREATE INDEX "ocr_tasks_ir_hash_idx" ON "ocr_tasks"("ir_hash");
