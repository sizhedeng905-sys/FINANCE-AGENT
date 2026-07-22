-- CreateEnum
CREATE TYPE "ImportAiReviewDecisionType" AS ENUM ('accept', 'edit', 'reject', 'ignore');

-- CreateTable
CREATE TABLE "import_ai_review_decisions" (
    "id" TEXT NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "import_column_id" TEXT NOT NULL,
    "ai_task_id" TEXT NOT NULL,
    "output_hash" VARCHAR(64) NOT NULL,
    "version_vector_hash" VARCHAR(64) NOT NULL,
    "source_ref" VARCHAR(200) NOT NULL,
    "template_version_id" VARCHAR(200) NOT NULL,
    "suggested_target_field_id" TEXT,
    "suggested_target_field_key" TEXT,
    "suggested_transform_key" VARCHAR(100) NOT NULL,
    "suggested_confidence" VARCHAR(32),
    "evidence_refs" JSONB NOT NULL DEFAULT '[]',
    "final_target_field_id" TEXT,
    "final_ignored" BOOLEAN NOT NULL DEFAULT false,
    "decision" "ImportAiReviewDecisionType" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "review_revision" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_ai_review_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_ai_review_decisions_output_hash_check"
        CHECK ("output_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "import_ai_review_decisions_version_vector_hash_check"
        CHECK ("version_vector_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "import_ai_review_decisions_review_revision_check"
        CHECK ("review_revision" > 0),
    CONSTRAINT "import_ai_review_decisions_reason_check"
        CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "import_ai_review_decisions_source_ref_check"
        CHECK (length(btrim("source_ref")) > 0),
    CONSTRAINT "import_ai_review_decisions_evidence_refs_check"
        CHECK (jsonb_typeof("evidence_refs") = 'array'),
    CONSTRAINT "import_ai_review_decisions_final_state_check"
        CHECK (
            ("decision" = 'ignore' AND "final_ignored" = true AND "final_target_field_id" IS NULL)
            OR
            ("decision" <> 'ignore' AND "final_ignored" = false AND "final_target_field_id" IS NOT NULL)
        )
);

-- CreateIndex
CREATE UNIQUE INDEX "import_ai_review_decisions_import_task_id_review_revision_s_key"
ON "import_ai_review_decisions"("import_task_id", "review_revision", "source_ref");

-- CreateIndex
CREATE INDEX "import_ai_review_decisions_import_task_id_created_at_idx"
ON "import_ai_review_decisions"("import_task_id", "created_at");

-- CreateIndex
CREATE INDEX "import_ai_review_decisions_import_column_id_idx"
ON "import_ai_review_decisions"("import_column_id");

-- CreateIndex
CREATE INDEX "import_ai_review_decisions_ai_task_id_idx"
ON "import_ai_review_decisions"("ai_task_id");

-- CreateIndex
CREATE INDEX "import_ai_review_decisions_actor_id_created_at_idx"
ON "import_ai_review_decisions"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_import_task_id_fkey"
FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_import_column_id_fkey"
FOREIGN KEY ("import_column_id") REFERENCES "import_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_ai_task_id_fkey"
FOREIGN KEY ("ai_task_id") REFERENCES "ai_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
