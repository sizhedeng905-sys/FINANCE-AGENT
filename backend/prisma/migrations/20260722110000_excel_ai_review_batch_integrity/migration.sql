-- A single AI output can produce only one immutable finance decision per
-- sourceRef. Stop the migration instead of collapsing contradictory history.
DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "import_ai_review_decisions"
        GROUP BY "ai_task_id", "source_ref"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce Excel AI review batch uniqueness: duplicate AI task source decisions exist';
    END IF;
END
$migration$;

CREATE UNIQUE INDEX "import_ai_review_decisions_ai_task_id_source_ref_key"
ON "import_ai_review_decisions"("ai_task_id", "source_ref");
