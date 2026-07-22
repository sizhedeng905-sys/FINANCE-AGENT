ALTER TABLE "ocr_tasks"
  ADD COLUMN "approval_snapshot_json" JSONB,
  ADD COLUMN "approval_snapshot_hash" TEXT,
  ADD COLUMN "approval_review_revision" INTEGER,
  ADD COLUMN "approval_validation_snapshot_hash" TEXT,
  ADD COLUMN "approval_policy_version" TEXT,
  ADD COLUMN "approval_request_key_hash" TEXT;

ALTER TABLE "ocr_tasks"
  ADD CONSTRAINT "ocr_tasks_approval_snapshot_consistent"
    CHECK (
      (
        "approval_snapshot_json" IS NULL
        AND "approval_snapshot_hash" IS NULL
        AND "approval_review_revision" IS NULL
        AND "approval_validation_snapshot_hash" IS NULL
        AND "approval_policy_version" IS NULL
        AND "approval_request_key_hash" IS NULL
      )
      OR (
        "approval_snapshot_json" IS NOT NULL
        AND "approval_snapshot_hash" ~ '^[0-9a-f]{64}$'
        AND "approval_review_revision" >= 0
        AND "approval_review_revision" <= "review_revision"
        AND "approval_validation_snapshot_hash" ~ '^[0-9a-f]{64}$'
        AND length(btrim("approval_policy_version")) BETWEEN 1 AND 100
        AND "approval_request_key_hash" ~ '^[0-9a-f]{64}$'
      )
    );

CREATE INDEX "ocr_tasks_approval_snapshot_hash_idx"
  ON "ocr_tasks"("approval_snapshot_hash");
