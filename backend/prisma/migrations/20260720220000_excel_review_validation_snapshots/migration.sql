ALTER TABLE "import_tasks"
  ADD COLUMN "review_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "validation_revision" INTEGER,
  ADD COLUMN "validation_snapshot_json" JSONB,
  ADD COLUMN "validation_snapshot_hash" TEXT,
  ADD COLUMN "validation_rule_version" TEXT,
  ADD COLUMN "validated_at" TIMESTAMP(3),
  ADD COLUMN "approval_snapshot_json" JSONB,
  ADD COLUMN "approval_snapshot_hash" TEXT,
  ADD COLUMN "approval_review_revision" INTEGER,
  ADD COLUMN "approval_validation_snapshot_hash" TEXT,
  ADD COLUMN "approval_policy_version" TEXT,
  ADD COLUMN "approval_request_key_hash" TEXT;

ALTER TABLE "import_tasks"
  ADD CONSTRAINT "import_tasks_validation_snapshot_consistent"
    CHECK (
      (
        "validation_revision" IS NULL
        AND "validation_snapshot_json" IS NULL
        AND "validation_snapshot_hash" IS NULL
        AND "validation_rule_version" IS NULL
        AND "validated_at" IS NULL
      )
      OR (
        "validation_revision" >= 0
        AND "validation_revision" <= "review_revision"
        AND "validation_snapshot_json" IS NOT NULL
        AND "validation_snapshot_hash" ~ '^[0-9a-f]{64}$'
        AND length(btrim("validation_rule_version")) BETWEEN 1 AND 100
        AND "validated_at" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "import_tasks_approval_snapshot_consistent"
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

ALTER TABLE "import_rows"
  ADD COLUMN "parser_status" "ImportRowStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "parser_errors" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "parser_warnings" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "review_decision" TEXT,
  ADD COLUMN "review_reason" TEXT,
  ADD COLUMN "reviewed_by" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD CONSTRAINT "import_rows_review_decision_consistent"
    CHECK (
      (
        "review_decision" IS NULL
        AND "review_reason" IS NULL
        AND "reviewed_by" IS NULL
        AND "reviewed_at" IS NULL
      )
      OR (
        "review_decision" IN ('include', 'exclude')
        AND length(btrim("review_reason")) BETWEEN 2 AND 500
        AND length(btrim("reviewed_by")) BETWEEN 1 AND 100
        AND "reviewed_at" IS NOT NULL
      )
    );

UPDATE "import_rows"
SET "parser_status" = "status",
    "parser_errors" = "errors",
    "parser_warnings" = "warnings";

CREATE INDEX "import_tasks_validation_snapshot_hash_idx"
  ON "import_tasks"("validation_snapshot_hash");
CREATE INDEX "import_tasks_approval_snapshot_hash_idx"
  ON "import_tasks"("approval_snapshot_hash");
CREATE INDEX "import_tasks_status_review_revision_idx"
  ON "import_tasks"("status", "review_revision");
CREATE INDEX "import_rows_import_task_id_review_decision_idx"
  ON "import_rows"("import_task_id", "review_decision");
