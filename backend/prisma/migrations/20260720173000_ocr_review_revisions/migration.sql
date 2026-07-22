ALTER TABLE "ocr_tasks"
  ADD COLUMN "review_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "validation_revision" INTEGER,
  ADD COLUMN "validation_snapshot_json" JSONB,
  ADD COLUMN "validation_snapshot_hash" TEXT,
  ADD COLUMN "validation_rule_version" TEXT,
  ADD COLUMN "validated_at" TIMESTAMP(3);

ALTER TABLE "ocr_corrections"
  ADD COLUMN "review_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "override_type" TEXT NOT NULL DEFAULT 'MANUAL_OVERRIDE',
  ADD COLUMN "evidence_refs" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "ocr_corrections"
SET "reason" = 'Legacy correction imported before review revision tracking'
WHERE "reason" IS NULL OR btrim("reason") = '';

ALTER TABLE "ocr_corrections"
  ALTER COLUMN "reason" SET NOT NULL;

ALTER TABLE "ocr_tasks"
  ADD CONSTRAINT "ocr_tasks_review_revision_nonnegative"
    CHECK ("review_revision" >= 0),
  ADD CONSTRAINT "ocr_tasks_validation_revision_valid"
    CHECK (
      "validation_revision" IS NULL
      OR ("validation_revision" >= 0 AND "validation_revision" <= "review_revision")
    ),
  ADD CONSTRAINT "ocr_tasks_validation_snapshot_consistent"
    CHECK (
      (
        "validation_snapshot_json" IS NULL
        AND "validation_snapshot_hash" IS NULL
        AND "validation_rule_version" IS NULL
        AND "validation_revision" IS NULL
        AND "validated_at" IS NULL
      )
      OR (
        "validation_snapshot_json" IS NOT NULL
        AND "validation_snapshot_hash" ~ '^[0-9a-f]{64}$'
        AND "validation_rule_version" IS NOT NULL
        AND "validation_revision" = "review_revision"
        AND "validated_at" IS NOT NULL
      )
    );

ALTER TABLE "ocr_corrections"
  ADD CONSTRAINT "ocr_corrections_review_revision_nonnegative"
    CHECK ("review_revision" >= 0),
  ADD CONSTRAINT "ocr_corrections_override_type_check"
    CHECK ("override_type" = 'MANUAL_OVERRIDE'),
  ADD CONSTRAINT "ocr_corrections_reason_nonblank"
    CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
  ADD CONSTRAINT "ocr_corrections_evidence_refs_array"
    CHECK (jsonb_typeof("evidence_refs") = 'array');

CREATE INDEX "ocr_tasks_status_review_revision_idx"
  ON "ocr_tasks"("status", "review_revision");

CREATE INDEX "ocr_corrections_ocr_task_id_review_revision_idx"
  ON "ocr_corrections"("ocr_task_id", "review_revision");
