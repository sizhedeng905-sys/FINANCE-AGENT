CREATE TYPE "RawFileStatus" AS ENUM ('uploaded', 'parsed', 'failed', 'voided');
CREATE TYPE "FileScanStatus" AS ENUM ('pending', 'clean', 'infected', 'failed');

CREATE TABLE "raw_files" (
  "id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "original_file_name" TEXT NOT NULL,
  "file_type" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" BIGINT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploaded_by" TEXT NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "related_project_id" TEXT,
  "related_work_order_id" TEXT,
  "status" "RawFileStatus" NOT NULL DEFAULT 'uploaded',
  "scan_status" "FileScanStatus" NOT NULL DEFAULT 'pending',
  "preview_status" TEXT NOT NULL DEFAULT 'original',
  "is_voided" BOOLEAN NOT NULL DEFAULT false,
  "void_reason" TEXT,
  "voided_at" TIMESTAMP(3),
  "voided_by" TEXT,
  CONSTRAINT "raw_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "raw_files_sha256_idx" ON "raw_files"("sha256");
CREATE INDEX "raw_files_uploaded_by_idx" ON "raw_files"("uploaded_by");
CREATE INDEX "raw_files_related_project_id_idx" ON "raw_files"("related_project_id");
CREATE INDEX "raw_files_related_work_order_id_idx" ON "raw_files"("related_work_order_id");
CREATE INDEX "raw_files_scan_status_idx" ON "raw_files"("scan_status");

ALTER TABLE "raw_files" ADD CONSTRAINT "raw_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "raw_files" ADD CONSTRAINT "raw_files_related_project_id_fkey" FOREIGN KEY ("related_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "raw_files" ADD CONSTRAINT "raw_files_related_work_order_id_fkey" FOREIGN KEY ("related_work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_order_attachments" ADD CONSTRAINT "work_order_attachments_raw_file_id_fkey" FOREIGN KEY ("raw_file_id") REFERENCES "raw_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
