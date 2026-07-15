ALTER TABLE "import_tasks"
  ADD COLUMN "parse_config" JSONB,
  ADD COLUMN "parse_requested_by" TEXT,
  ADD COLUMN "execution_mode" TEXT,
  ADD COLUMN "processing_mode" TEXT,
  ADD COLUMN "processed_rows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "parse_attempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "import_tasks"
  ADD CONSTRAINT "import_tasks_execution_mode_check"
  CHECK ("execution_mode" IS NULL OR "execution_mode" IN ('synchronous', 'background')),
  ADD CONSTRAINT "import_tasks_processing_mode_check"
  CHECK ("processing_mode" IS NULL OR "processing_mode" IN ('document', 'streaming')),
  ADD CONSTRAINT "import_tasks_processed_rows_check"
  CHECK ("processed_rows" >= 0 AND "processed_rows" <= "total_rows"),
  ADD CONSTRAINT "import_tasks_parse_attempts_check"
  CHECK ("parse_attempts" >= 0);

CREATE INDEX "import_tasks_background_recovery_idx"
  ON "import_tasks"("status", "execution_mode", "lease_until")
  WHERE "execution_mode" = 'background';
