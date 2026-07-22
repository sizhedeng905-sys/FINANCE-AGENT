-- CreateEnum
CREATE TYPE "ImportTaskStatus" AS ENUM ('uploaded', 'parsed', 'mapping', 'pending_confirm', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('pending', 'mapped', 'error', 'confirmed', 'duplicate', 'ignored');

-- CreateEnum
CREATE TYPE "MappingDecisionType" AS ENUM ('profile', 'field_key', 'exact_name', 'alias', 'normalized', 'fuzzy', 'manual', 'ignored');

-- CreateEnum
CREATE TYPE "FieldSuggestionStatus" AS ENUM ('pending', 'approved', 'rejected', 'mapped_to_existing');

-- AlterTable
ALTER TABLE "business_records" ADD COLUMN     "import_task_id" TEXT;

-- CreateTable
CREATE TABLE "import_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "raw_file_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "import_type" "DataRecordType" NOT NULL,
    "status" "ImportTaskStatus" NOT NULL DEFAULT 'uploaded',
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsed_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "error_message" TEXT,
    "idempotency_key" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "ignored_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_sheets" (
    "id" TEXT NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "sheet_index" INTEGER NOT NULL,
    "header_row_index" INTEGER NOT NULL DEFAULT 1,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_columns" (
    "id" TEXT NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "column_index" INTEGER NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "sample_values" JSONB NOT NULL DEFAULT '[]',
    "inferred_type" TEXT NOT NULL,
    "duplicate_name" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_data_json" JSONB NOT NULL,
    "normalized_data_json" JSONB,
    "row_hash" TEXT NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'pending',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "confirmed_at" TIMESTAMP(3),
    "generated_record_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_profiles" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_profile_rules" (
    "id" TEXT NOT NULL,
    "mapping_profile_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "normalized_source_name" TEXT NOT NULL,
    "target_field_id" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_profile_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_decisions" (
    "id" TEXT NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "import_column_id" TEXT NOT NULL,
    "target_field_id" TEXT,
    "mapping_type" "MappingDecisionType" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_suggestions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "import_column_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "suggested_field_name" TEXT NOT NULL,
    "suggested_field_type" "FieldType" NOT NULL,
    "sample_values" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "status" "FieldSuggestionStatus" NOT NULL DEFAULT 'pending',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "mapped_field_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_tasks_raw_file_id_key" ON "import_tasks"("raw_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_tasks_idempotency_key_key" ON "import_tasks"("idempotency_key");

-- CreateIndex
CREATE INDEX "import_tasks_project_id_created_at_idx" ON "import_tasks"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "import_tasks_template_id_idx" ON "import_tasks"("template_id");

-- CreateIndex
CREATE INDEX "import_tasks_status_idx" ON "import_tasks"("status");

-- CreateIndex
CREATE INDEX "import_tasks_uploaded_by_idx" ON "import_tasks"("uploaded_by");

-- CreateIndex
CREATE INDEX "import_sheets_import_task_id_idx" ON "import_sheets"("import_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_sheets_import_task_id_sheet_index_key" ON "import_sheets"("import_task_id", "sheet_index");

-- CreateIndex
CREATE INDEX "import_columns_import_task_id_idx" ON "import_columns"("import_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_columns_sheet_id_column_index_key" ON "import_columns"("sheet_id", "column_index");

-- CreateIndex
CREATE UNIQUE INDEX "import_columns_import_task_id_source_key_key" ON "import_columns"("import_task_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_generated_record_id_key" ON "import_rows"("generated_record_id");

-- CreateIndex
CREATE INDEX "import_rows_import_task_id_status_idx" ON "import_rows"("import_task_id", "status");

-- CreateIndex
CREATE INDEX "import_rows_row_hash_idx" ON "import_rows"("row_hash");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_sheet_id_row_number_key" ON "import_rows"("sheet_id", "row_number");

-- CreateIndex
CREATE INDEX "mapping_profiles_template_id_is_active_idx" ON "mapping_profiles"("template_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_profiles_template_id_name_key" ON "mapping_profiles"("template_id", "name");

-- CreateIndex
CREATE INDEX "mapping_profile_rules_target_field_id_idx" ON "mapping_profile_rules"("target_field_id");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_profile_rules_mapping_profile_id_normalized_source__key" ON "mapping_profile_rules"("mapping_profile_id", "normalized_source_name");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_decisions_import_column_id_key" ON "mapping_decisions"("import_column_id");

-- CreateIndex
CREATE INDEX "mapping_decisions_import_task_id_idx" ON "mapping_decisions"("import_task_id");

-- CreateIndex
CREATE INDEX "mapping_decisions_target_field_id_idx" ON "mapping_decisions"("target_field_id");

-- CreateIndex
CREATE UNIQUE INDEX "field_suggestions_import_column_id_key" ON "field_suggestions"("import_column_id");

-- CreateIndex
CREATE INDEX "field_suggestions_project_id_status_idx" ON "field_suggestions"("project_id", "status");

-- CreateIndex
CREATE INDEX "field_suggestions_template_id_idx" ON "field_suggestions"("template_id");

-- CreateIndex
CREATE INDEX "field_suggestions_import_task_id_idx" ON "field_suggestions"("import_task_id");

-- CreateIndex
CREATE INDEX "business_records_import_task_id_idx" ON "business_records"("import_task_id");

-- AddForeignKey
ALTER TABLE "business_records" ADD CONSTRAINT "business_records_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_raw_file_id_fkey" FOREIGN KEY ("raw_file_id") REFERENCES "raw_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_sheets" ADD CONSTRAINT "import_sheets_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_columns" ADD CONSTRAINT "import_columns_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_columns" ADD CONSTRAINT "import_columns_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "import_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "import_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_generated_record_id_fkey" FOREIGN KEY ("generated_record_id") REFERENCES "business_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profile_rules" ADD CONSTRAINT "mapping_profile_rules_mapping_profile_id_fkey" FOREIGN KEY ("mapping_profile_id") REFERENCES "mapping_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profile_rules" ADD CONSTRAINT "mapping_profile_rules_target_field_id_fkey" FOREIGN KEY ("target_field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_decisions" ADD CONSTRAINT "mapping_decisions_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_decisions" ADD CONSTRAINT "mapping_decisions_import_column_id_fkey" FOREIGN KEY ("import_column_id") REFERENCES "import_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_decisions" ADD CONSTRAINT "mapping_decisions_target_field_id_fkey" FOREIGN KEY ("target_field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_import_task_id_fkey" FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_import_column_id_fkey" FOREIGN KEY ("import_column_id") REFERENCES "import_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_mapped_field_id_fkey" FOREIGN KEY ("mapped_field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
