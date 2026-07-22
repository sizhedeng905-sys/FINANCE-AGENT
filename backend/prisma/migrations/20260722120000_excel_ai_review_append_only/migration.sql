-- Finance review decisions are audit evidence. Parent deletion must not bypass
-- their append-only guard through a cascading foreign key.
ALTER TABLE "import_ai_review_decisions"
DROP CONSTRAINT "import_ai_review_decisions_import_task_id_fkey";

ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_import_task_id_fkey"
FOREIGN KEY ("import_task_id") REFERENCES "import_tasks"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_ai_review_decisions"
DROP CONSTRAINT "import_ai_review_decisions_import_column_id_fkey";

ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_import_column_id_fkey"
FOREIGN KEY ("import_column_id") REFERENCES "import_columns"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_import_ai_review_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('app.allow_import_ai_review_purge', true) = 'on'
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'immutable import AI review decisions cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "import_ai_review_decisions_immutable"
BEFORE UPDATE OR DELETE ON "import_ai_review_decisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_import_ai_review_mutation"();
