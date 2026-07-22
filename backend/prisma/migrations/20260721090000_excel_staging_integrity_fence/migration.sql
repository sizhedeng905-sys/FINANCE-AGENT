ALTER TABLE "business_records"
  ADD COLUMN "staging_content_hash" VARCHAR(64),
  ADD COLUMN "staging_approval_hash" VARCHAR(64);

ALTER TABLE "import_rows"
  ADD COLUMN "generated_record_hash" VARCHAR(64),
  ADD COLUMN "generated_record_value_count" INTEGER;

ALTER TABLE "business_records"
  ADD CONSTRAINT "business_records_staging_hash_format_check"
  CHECK (
    ("staging_content_hash" IS NULL OR "staging_content_hash" ~ '^[0-9a-f]{64}$')
    AND ("staging_approval_hash" IS NULL OR "staging_approval_hash" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_generated_record_hash_format_check"
  CHECK ("generated_record_hash" IS NULL OR "generated_record_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "import_rows_generated_record_value_count_check"
  CHECK ("generated_record_value_count" IS NULL OR "generated_record_value_count" >= 0);

CREATE FUNCTION "invalidate_unpublished_business_record_integrity"() RETURNS trigger AS $$
BEGIN
  IF OLD."publication_status" = 'unpublished'
     AND NEW."publication_status" = 'unpublished'
     AND ROW(
       NEW."project_id",
       NEW."template_id",
       NEW."record_type",
       NEW."accounting_direction",
       NEW."data_layer",
       NEW."template_version",
       NEW."template_snapshot",
       NEW."source_snapshot",
       NEW."confirmation_snapshot",
       NEW."version",
       NEW."record_date",
       NEW."amount",
       NEW."currency",
       NEW."category",
       NEW."sub_category",
       NEW."description",
       NEW."source_type",
       NEW."source_id",
       NEW."import_task_id",
       NEW."status",
       NEW."attachments",
       NEW."created_by",
       NEW."confirmed_at",
       NEW."confirmed_by",
       NEW."voided_at",
       NEW."voided_by",
       NEW."staging_approval_hash"
     ) IS DISTINCT FROM ROW(
       OLD."project_id",
       OLD."template_id",
       OLD."record_type",
       OLD."accounting_direction",
       OLD."data_layer",
       OLD."template_version",
       OLD."template_snapshot",
       OLD."source_snapshot",
       OLD."confirmation_snapshot",
       OLD."version",
       OLD."record_date",
       OLD."amount",
       OLD."currency",
       OLD."category",
       OLD."sub_category",
       OLD."description",
       OLD."source_type",
       OLD."source_id",
       OLD."import_task_id",
       OLD."status",
       OLD."attachments",
       OLD."created_by",
       OLD."confirmed_at",
       OLD."confirmed_by",
       OLD."voided_at",
       OLD."voided_by",
       OLD."staging_approval_hash"
     )
  THEN
    NEW."staging_content_hash" := NULL;
    NEW."version" := OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "business_records_unpublished_integrity_guard"
  BEFORE UPDATE ON "business_records"
  FOR EACH ROW EXECUTE FUNCTION "invalidate_unpublished_business_record_integrity"();

CREATE FUNCTION "invalidate_unpublished_record_value_integrity"() RETURNS trigger AS $$
DECLARE
  target_record_id TEXT;
BEGIN
  target_record_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."record_id" ELSE NEW."record_id" END;
  UPDATE "business_records"
  SET "staging_content_hash" = NULL,
      "version" = "version" + 1
  WHERE "id" = target_record_id
    AND "publication_status" = 'unpublished'
    AND "staging_content_hash" IS NOT NULL;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "record_values_unpublished_integrity_guard"
  AFTER INSERT OR UPDATE OR DELETE ON "record_values"
  FOR EACH ROW EXECUTE FUNCTION "invalidate_unpublished_record_value_integrity"();

CREATE FUNCTION "invalidate_sealed_import_row_integrity"() RETURNS trigger AS $$
BEGIN
  IF OLD."confirmation_processed_at" IS NOT NULL
     AND OLD."generated_record_hash" IS NOT NULL
     AND OLD."status" = 'mapped'
     AND NEW."status" = 'mapped'
     AND ROW(
       NEW."import_task_id",
       NEW."sheet_id",
       NEW."row_number",
       NEW."raw_data_json",
       NEW."normalized_data_json",
       NEW."row_hash",
       NEW."parser_status",
       NEW."parser_errors",
       NEW."parser_warnings",
       NEW."errors",
       NEW."warnings",
       NEW."cell_evidence_json",
       NEW."evidence_hash",
       NEW."review_decision",
       NEW."review_reason",
       NEW."reviewed_by",
       NEW."reviewed_at",
       NEW."confirmed_at",
       NEW."confirmation_processed_at",
       NEW."generated_record_id",
       NEW."generated_record_hash",
       NEW."generated_record_value_count"
     ) IS DISTINCT FROM ROW(
       OLD."import_task_id",
       OLD."sheet_id",
       OLD."row_number",
       OLD."raw_data_json",
       OLD."normalized_data_json",
       OLD."row_hash",
       OLD."parser_status",
       OLD."parser_errors",
       OLD."parser_warnings",
       OLD."errors",
       OLD."warnings",
       OLD."cell_evidence_json",
       OLD."evidence_hash",
       OLD."review_decision",
       OLD."review_reason",
       OLD."reviewed_by",
       OLD."reviewed_at",
       OLD."confirmed_at",
       OLD."confirmation_processed_at",
       OLD."generated_record_id",
       OLD."generated_record_hash",
       OLD."generated_record_value_count"
     )
  THEN
    UPDATE "business_records"
    SET "staging_content_hash" = NULL,
        "version" = "version" + 1
    WHERE "id" = OLD."generated_record_id"
      AND "publication_status" = 'unpublished'
      AND "staging_content_hash" IS NOT NULL;
    NEW."generated_record_hash" := NULL;
    NEW."generated_record_value_count" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "import_rows_sealed_integrity_guard"
  BEFORE UPDATE ON "import_rows"
  FOR EACH ROW EXECUTE FUNCTION "invalidate_sealed_import_row_integrity"();
