ALTER TABLE "ai_tasks"
  ADD COLUMN "lease_token" VARCHAR(36),
  ADD COLUMN "lease_until" TIMESTAMP(3);

CREATE INDEX "ai_tasks_status_lease_until_idx" ON "ai_tasks"("status", "lease_until");

ALTER TABLE "ai_tasks"
  DROP CONSTRAINT "ai_tasks_content_address_contract";

ALTER TABLE "ai_tasks"
  ADD CONSTRAINT "ai_tasks_content_address_contract" CHECK (
    "request_key" IS NULL
    OR (
      "request_key" ~ '^[0-9a-f]{64}$'
      AND "input_hash" ~ '^[0-9a-f]{64}$'
      AND "version_vector_hash" ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof("version_vector") = 'object'
      AND ("output_hash" IS NULL OR "output_hash" ~ '^[0-9a-f]{64}$')
      AND (
        (
          "status" = 'running'
          AND "lease_token" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND "lease_until" IS NOT NULL
        )
        OR (
          "status" <> 'running'
          AND "lease_token" IS NULL
          AND "lease_until" IS NULL
        )
      )
      AND ("status" <> 'succeeded' OR "output_hash" IS NOT NULL)
    )
  );
