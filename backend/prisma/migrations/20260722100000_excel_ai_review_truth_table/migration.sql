-- Contradictory review facts must be investigated rather than rewritten by a
-- schema migration. The preflight keeps the upgrade fail-closed.
DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "import_ai_review_decisions"
        WHERE (
            "suggested_target_field_id" IS NOT NULL
            AND "suggested_target_field_key" IS NOT NULL
            AND (
                (
                    "decision" = 'accept'
                    AND "final_ignored" = false
                    AND "final_target_field_id" = "suggested_target_field_id"
                )
                OR (
                    "decision" IN ('edit', 'reject')
                    AND "final_ignored" = false
                    AND "final_target_field_id" IS NOT NULL
                    AND "final_target_field_id" <> "suggested_target_field_id"
                )
                OR (
                    "decision" = 'ignore'
                    AND "final_ignored" = true
                    AND "final_target_field_id" IS NULL
                )
            )
        ) IS NOT TRUE
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce Excel AI review truth table: contradictory historical decisions exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "import_ai_review_decisions"
        WHERE char_length(btrim("reason")) NOT BETWEEN 2 AND 200
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce Excel AI review reason bounds: historical reasons require review';
    END IF;
END
$migration$;

ALTER TABLE "import_ai_review_decisions"
DROP CONSTRAINT "import_ai_review_decisions_final_state_check",
DROP CONSTRAINT "import_ai_review_decisions_reason_check";

ALTER TABLE "import_ai_review_decisions"
ALTER COLUMN "reason" TYPE VARCHAR(200);

ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_reason_check"
CHECK (char_length(btrim("reason")) BETWEEN 2 AND 200),
ADD CONSTRAINT "import_ai_review_decisions_final_state_check"
CHECK (
    "suggested_target_field_id" IS NOT NULL
    AND "suggested_target_field_key" IS NOT NULL
    AND (
        (
            "decision" = 'accept'
            AND "final_ignored" = false
            AND "final_target_field_id" = "suggested_target_field_id"
        )
        OR (
            "decision" IN ('edit', 'reject')
            AND "final_ignored" = false
            AND "final_target_field_id" IS NOT NULL
            AND "final_target_field_id" <> "suggested_target_field_id"
        )
        OR (
            "decision" = 'ignore'
            AND "final_ignored" = true
            AND "final_target_field_id" IS NULL
        )
    )
);
