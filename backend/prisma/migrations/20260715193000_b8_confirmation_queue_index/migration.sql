CREATE INDEX "idx_import_rows_confirmation_queue"
ON "import_rows"("import_task_id", "confirmation_processed_at", "row_number");
