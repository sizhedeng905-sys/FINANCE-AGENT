ALTER TABLE "users"
ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "audit_logs"
ADD COLUMN "request_id" TEXT,
ADD COLUMN "failure_reason" TEXT;

CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");
