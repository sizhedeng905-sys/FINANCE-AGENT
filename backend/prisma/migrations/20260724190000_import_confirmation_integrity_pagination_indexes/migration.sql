-- Keep final approval and staging integrity scans on ordered, task-local
-- index paths as prior imports accumulate.
CREATE INDEX "business_records_import_task_id_id_idx"
ON "business_records"("import_task_id", "id");

CREATE INDEX "import_rows_import_task_id_row_number_id_idx"
ON "import_rows"("import_task_id", "row_number", "id");
