ALTER TABLE "ai_tasks"
  ADD COLUMN "request_key" VARCHAR(64),
  ADD COLUMN "version_vector" JSONB,
  ADD COLUMN "version_vector_hash" VARCHAR(64),
  ADD COLUMN "output_hash" VARCHAR(64);

CREATE UNIQUE INDEX "ai_tasks_request_key_key" ON "ai_tasks"("request_key");
CREATE INDEX "ai_tasks_version_vector_hash_idx" ON "ai_tasks"("version_vector_hash");

ALTER TABLE "ai_tasks"
  ADD CONSTRAINT "ai_tasks_content_address_contract" CHECK (
    "input_hash" ~ '^[0-9a-f]{64}$'
    AND ("request_key" IS NULL OR "request_key" ~ '^[0-9a-f]{64}$')
    AND ("version_vector_hash" IS NULL OR "version_vector_hash" ~ '^[0-9a-f]{64}$')
    AND ("output_hash" IS NULL OR "output_hash" ~ '^[0-9a-f]{64}$')
    AND ("version_vector" IS NULL OR jsonb_typeof("version_vector") = 'object')
  );
