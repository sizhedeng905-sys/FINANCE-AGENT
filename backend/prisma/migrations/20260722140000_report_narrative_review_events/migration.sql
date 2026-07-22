-- Narrative review decisions are append-only workflow facts. They can change
-- only the interpretation status of AI-generated text, never financial facts.
CREATE TYPE "ReportNarrativeReviewStatus" AS ENUM (
  'NEEDS_FINANCE_REVIEW',
  'NEEDS_BOSS_REVIEW',
  'CHANGES_REQUESTED',
  'REJECTED',
  'ACCEPTED'
);

CREATE TYPE "ReportNarrativeReviewStage" AS ENUM ('FINANCE', 'BOSS');
CREATE TYPE "ReportNarrativeReviewCommand" AS ENUM ('ACCEPT', 'REQUEST_CHANGES', 'REJECT');

CREATE TABLE "report_narrative_review_decisions" (
  "id" TEXT NOT NULL,
  "narrative_id" TEXT NOT NULL,
  "review_version" INTEGER NOT NULL,
  "stage" "ReportNarrativeReviewStage" NOT NULL,
  "command" "ReportNarrativeReviewCommand" NOT NULL,
  "from_status" "ReportNarrativeReviewStatus" NOT NULL,
  "to_status" "ReportNarrativeReviewStatus" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "actor_username" TEXT NOT NULL,
  "actor_name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "report_narrative_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_report_narrative_review_version_stage" CHECK (
    ("stage" = 'FINANCE' AND "review_version" = 1)
    OR ("stage" = 'BOSS' AND "review_version" = 2)
  ),
  CONSTRAINT "ck_report_narrative_review_reason" CHECK (
    char_length(btrim("reason")) BETWEEN 2 AND 500
    AND "reason" !~ '[[:cntrl:]]'
  ),
  CONSTRAINT "ck_report_narrative_review_transition" CHECK (
    (
      "stage" = 'FINANCE'
      AND "from_status" = 'NEEDS_FINANCE_REVIEW'
      AND (
        ("command" = 'ACCEPT' AND "to_status" = 'NEEDS_BOSS_REVIEW')
        OR ("command" = 'REQUEST_CHANGES' AND "to_status" = 'CHANGES_REQUESTED')
        OR ("command" = 'REJECT' AND "to_status" = 'REJECTED')
      )
    )
    OR (
      "stage" = 'BOSS'
      AND "from_status" = 'NEEDS_BOSS_REVIEW'
      AND (
        ("command" = 'ACCEPT' AND "to_status" = 'ACCEPTED')
        OR ("command" = 'REQUEST_CHANGES' AND "to_status" = 'CHANGES_REQUESTED')
        OR ("command" = 'REJECT' AND "to_status" = 'REJECTED')
      )
    )
  )
);

CREATE UNIQUE INDEX "uq_report_narrative_review_version"
ON "report_narrative_review_decisions"("narrative_id", "review_version");

CREATE UNIQUE INDEX "uq_report_narrative_review_stage"
ON "report_narrative_review_decisions"("narrative_id", "stage");

CREATE INDEX "idx_report_narrative_review_created"
ON "report_narrative_review_decisions"("narrative_id", "created_at");

CREATE INDEX "idx_report_narrative_review_actor"
ON "report_narrative_review_decisions"("actor_user_id", "created_at");

ALTER TABLE "report_narrative_review_decisions"
ADD CONSTRAINT "fk_report_narrative_review_narrative"
FOREIGN KEY ("narrative_id") REFERENCES "report_narratives"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "report_narrative_review_decisions"
ADD CONSTRAINT "fk_report_narrative_review_actor"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "report_narrative_review_decisions_immutable"
BEFORE UPDATE OR DELETE ON "report_narrative_review_decisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_report_audit_mutation"();
