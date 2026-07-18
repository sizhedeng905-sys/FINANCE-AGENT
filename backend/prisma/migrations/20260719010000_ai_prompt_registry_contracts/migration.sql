ALTER TABLE "ai_prompt_versions"
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "input_schema_version" TEXT,
  ADD COLUMN "output_schema_version" TEXT,
  ADD COLUMN "allowed_provider_classes" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "max_input_budget" INTEGER,
  ADD COLUMN "timeout_policy" JSONB,
  ADD COLUMN "redaction_policy_version" TEXT,
  ADD COLUMN "required_components" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "content_sha256" VARCHAR(64),
  ADD COLUMN "retired_at" TIMESTAMP(3);

ALTER TABLE "ai_prompt_versions"
  ADD CONSTRAINT "ai_prompt_versions_registry_contract" CHECK (
    jsonb_typeof("allowed_provider_classes") = 'array'
    AND jsonb_typeof("required_components") = 'array'
    AND ("timeout_policy" IS NULL OR jsonb_typeof("timeout_policy") = 'object')
    AND ("max_input_budget" IS NULL OR "max_input_budget" BETWEEN 1 AND 1000000)
    AND ("content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-f]{64}$')
    AND ("retired_at" IS NULL OR "is_active" = FALSE)
    AND (
      "content_sha256" IS NULL
      OR (
        "purpose" IS NOT NULL
        AND "input_schema_version" IS NOT NULL
        AND "output_schema_version" IS NOT NULL
        AND "output_schema_json" IS NOT NULL
        AND "max_input_budget" IS NOT NULL
        AND "timeout_policy" IS NOT NULL
        AND "redaction_policy_version" IS NOT NULL
      )
    )
  );

CREATE UNIQUE INDEX "ai_prompt_versions_one_active_key_idx"
  ON "ai_prompt_versions"("prompt_key")
  WHERE "is_active" = TRUE AND "retired_at" IS NULL;

CREATE INDEX "ai_prompt_versions_content_sha256_idx"
  ON "ai_prompt_versions"("content_sha256");
