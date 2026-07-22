-- OCR AI review decisions extend the existing OCR task/revision pipeline with
-- immutable per-field evidence. They never grant approval or write records.
CREATE TABLE "ocr_ai_review_decisions" (
  "id" TEXT NOT NULL,
  "ocr_task_id" TEXT NOT NULL,
  "source_field_id" TEXT NOT NULL,
  "ai_task_id" TEXT NOT NULL,
  "output_hash" VARCHAR(64) NOT NULL,
  "version_vector_hash" VARCHAR(64) NOT NULL,
  "review_state_hash" VARCHAR(64) NOT NULL,
  "review_basis_hash" VARCHAR(64) NOT NULL,
  "source_ref" VARCHAR(200) NOT NULL,
  "template_version_id" VARCHAR(200) NOT NULL,
  "raw_ocr_value_json" JSONB NOT NULL,
  "raw_evidence_refs" JSONB NOT NULL DEFAULT '[]',
  "suggested_target_field_id" TEXT,
  "suggested_target_field_key" VARCHAR(200),
  "suggested_transform_key" VARCHAR(100),
  "suggested_confidence" VARCHAR(32),
  "suggested_value_json" JSONB,
  "suggested_evidence_refs" JSONB NOT NULL DEFAULT '[]',
  "final_target_field_id" TEXT,
  "final_value_json" JSONB,
  "final_evidence_refs" JSONB NOT NULL DEFAULT '[]',
  "decision" "ImportAiReviewDecisionType" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "review_revision" INTEGER NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ocr_ai_review_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ocr_ai_review_decisions_ocr_task_id_review_revision_source_ref_key"
ON "ocr_ai_review_decisions"("ocr_task_id", "review_revision", "source_ref");

CREATE UNIQUE INDEX "ocr_ai_review_decisions_ai_task_id_source_ref_key"
ON "ocr_ai_review_decisions"("ai_task_id", "source_ref");

CREATE INDEX "ocr_ai_review_decisions_ocr_task_id_created_at_idx"
ON "ocr_ai_review_decisions"("ocr_task_id", "created_at");

CREATE INDEX "ocr_ai_review_decisions_source_field_id_idx"
ON "ocr_ai_review_decisions"("source_field_id");

CREATE INDEX "ocr_ai_review_decisions_ai_task_id_idx"
ON "ocr_ai_review_decisions"("ai_task_id");

CREATE INDEX "ocr_ai_review_decisions_review_basis_hash_idx"
ON "ocr_ai_review_decisions"("review_basis_hash");

CREATE INDEX "ocr_ai_review_decisions_actor_id_created_at_idx"
ON "ocr_ai_review_decisions"("actor_id", "created_at");

ALTER TABLE "ocr_ai_review_decisions"
ADD CONSTRAINT "ocr_ai_review_decisions_ocr_task_id_fkey"
FOREIGN KEY ("ocr_task_id") REFERENCES "ocr_tasks"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ocr_ai_review_decisions"
ADD CONSTRAINT "ocr_ai_review_decisions_source_field_id_fkey"
FOREIGN KEY ("source_field_id") REFERENCES "field_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ocr_ai_review_decisions"
ADD CONSTRAINT "ocr_ai_review_decisions_ai_task_id_fkey"
FOREIGN KEY ("ai_task_id") REFERENCES "ai_tasks"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ocr_ai_review_decisions"
ADD CONSTRAINT "ocr_ai_review_decisions_suggested_target_field_id_fkey"
FOREIGN KEY ("suggested_target_field_id") REFERENCES "field_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ocr_ai_review_decisions"
ADD CONSTRAINT "ocr_ai_review_decisions_final_target_field_id_fkey"
FOREIGN KEY ("final_target_field_id") REFERENCES "field_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ocr_ai_review_decisions"
ADD CONSTRAINT "ocr_ai_review_decisions_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_ocr_ai_review_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('app.allow_ocr_ai_review_purge', true) = 'on'
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'immutable OCR AI review decisions cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ocr_ai_review_decisions_immutable"
BEFORE UPDATE OR DELETE ON "ocr_ai_review_decisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_ocr_ai_review_mutation"();
