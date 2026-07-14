-- CreateEnum
CREATE TYPE "OcrTaskStatus" AS ENUM ('uploaded', 'queued', 'processing', 'pending_confirm', 'confirmed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "OcrAttemptStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "ocr_tasks" (
    "id" TEXT NOT NULL,
    "raw_file_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" "OcrTaskStatus" NOT NULL DEFAULT 'uploaded',
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_version" TEXT,
    "endpoint_snapshot" TEXT,
    "provider_options" JSONB,
    "extracted_text" TEXT,
    "extracted_fields" JSONB NOT NULL DEFAULT '{}',
    "field_confidence_json" JSONB NOT NULL DEFAULT '{}',
    "pages" JSONB NOT NULL DEFAULT '[]',
    "text_blocks" JSONB NOT NULL DEFAULT '[]',
    "tables" JSONB NOT NULL DEFAULT '[]',
    "field_candidates" JSONB NOT NULL DEFAULT '[]',
    "raw_result" JSONB,
    "raw_result_ref" TEXT,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "avg_confidence" DECIMAL(6,4),
    "latency_ms" INTEGER,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "generated_record_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocr_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_attempts" (
    "id" TEXT NOT NULL,
    "ocr_task_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" "OcrAttemptStatus" NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_version" TEXT,
    "endpoint_snapshot" TEXT,
    "input_sha256" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "latency_ms" INTEGER,
    "page_count" INTEGER,
    "raw_result" JSONB,
    "raw_result_ref" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_corrections" (
    "id" TEXT NOT NULL,
    "ocr_task_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "before_value" TEXT,
    "after_value" TEXT NOT NULL,
    "original_confidence" DECIMAL(6,4),
    "reason" TEXT,
    "corrected_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocr_tasks_generated_record_id_key" ON "ocr_tasks"("generated_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_tasks_idempotency_key_key" ON "ocr_tasks"("idempotency_key");

-- CreateIndex
CREATE INDEX "ocr_tasks_project_id_created_at_idx" ON "ocr_tasks"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "ocr_tasks_template_id_idx" ON "ocr_tasks"("template_id");

-- CreateIndex
CREATE INDEX "ocr_tasks_raw_file_id_idx" ON "ocr_tasks"("raw_file_id");

-- CreateIndex
CREATE INDEX "ocr_tasks_status_idx" ON "ocr_tasks"("status");

-- CreateIndex
CREATE INDEX "ocr_tasks_uploaded_by_idx" ON "ocr_tasks"("uploaded_by");

-- CreateIndex
CREATE INDEX "ocr_attempts_ocr_task_id_created_at_idx" ON "ocr_attempts"("ocr_task_id", "created_at");

-- CreateIndex
CREATE INDEX "ocr_attempts_correlation_id_idx" ON "ocr_attempts"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_attempts_ocr_task_id_attempt_no_key" ON "ocr_attempts"("ocr_task_id", "attempt_no");

-- CreateIndex
CREATE INDEX "ocr_corrections_ocr_task_id_created_at_idx" ON "ocr_corrections"("ocr_task_id", "created_at");

-- CreateIndex
CREATE INDEX "ocr_corrections_field_id_idx" ON "ocr_corrections"("field_id");

-- CreateIndex
CREATE INDEX "ocr_corrections_corrected_by_idx" ON "ocr_corrections"("corrected_by");

-- AddForeignKey
ALTER TABLE "ocr_tasks" ADD CONSTRAINT "ocr_tasks_raw_file_id_fkey" FOREIGN KEY ("raw_file_id") REFERENCES "raw_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_tasks" ADD CONSTRAINT "ocr_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_tasks" ADD CONSTRAINT "ocr_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_tasks" ADD CONSTRAINT "ocr_tasks_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_tasks" ADD CONSTRAINT "ocr_tasks_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_tasks" ADD CONSTRAINT "ocr_tasks_generated_record_id_fkey" FOREIGN KEY ("generated_record_id") REFERENCES "business_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_attempts" ADD CONSTRAINT "ocr_attempts_ocr_task_id_fkey" FOREIGN KEY ("ocr_task_id") REFERENCES "ocr_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_corrections" ADD CONSTRAINT "ocr_corrections_ocr_task_id_fkey" FOREIGN KEY ("ocr_task_id") REFERENCES "ocr_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_corrections" ADD CONSTRAINT "ocr_corrections_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_corrections" ADD CONSTRAINT "ocr_corrections_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
