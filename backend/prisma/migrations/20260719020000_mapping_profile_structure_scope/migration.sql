CREATE TYPE "MappingProfileStatus" AS ENUM ('active', 'stale', 'revoked');

ALTER TABLE "mapping_profiles"
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "template_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "profile_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "source_structure_fingerprint" VARCHAR(64),
  ADD COLUMN "fingerprint_version" TEXT,
  ADD COLUMN "transform_registry_version" TEXT,
  ADD COLUMN "policy_version" TEXT,
  ADD COLUMN "scope_key" VARCHAR(64),
  ADD COLUMN "approval_snapshot_hash" VARCHAR(64),
  ADD COLUMN "status" "MappingProfileStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "usage_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_used_at" TIMESTAMP(3),
  ADD COLUMN "created_from_task_id" TEXT;

-- Profiles created before structural scoping are intentionally not reusable.
UPDATE "mapping_profiles"
SET "status" = 'stale', "is_active" = FALSE
WHERE "project_id" IS NULL OR "source_structure_fingerprint" IS NULL;

DROP INDEX "mapping_profiles_template_id_name_key";

CREATE UNIQUE INDEX "mapping_profiles_scope_key_key"
  ON "mapping_profiles"("scope_key");
CREATE INDEX "mapping_profiles_template_id_name_idx"
  ON "mapping_profiles"("template_id", "name");
CREATE INDEX "mapping_profiles_project_id_template_id_status_idx"
  ON "mapping_profiles"("project_id", "template_id", "status");
CREATE INDEX "mapping_profiles_source_structure_fingerprint_idx"
  ON "mapping_profiles"("source_structure_fingerprint");

ALTER TABLE "mapping_profiles"
  ADD CONSTRAINT "mapping_profiles_structure_contract" CHECK (
    "profile_version" >= 1
    AND "template_version" >= 1
    AND "usage_count" >= 0
    AND ("source_structure_fingerprint" IS NULL OR "source_structure_fingerprint" ~ '^[0-9a-f]{64}$')
    AND ("scope_key" IS NULL OR "scope_key" ~ '^[0-9a-f]{64}$')
    AND ("approval_snapshot_hash" IS NULL OR "approval_snapshot_hash" ~ '^[0-9a-f]{64}$')
    AND (
      "status" <> 'active'
      OR (
        "is_active" = TRUE
        AND "project_id" IS NOT NULL
        AND "source_structure_fingerprint" IS NOT NULL
        AND "fingerprint_version" IS NOT NULL
        AND "transform_registry_version" IS NOT NULL
        AND "policy_version" IS NOT NULL
        AND "scope_key" IS NOT NULL
        AND "approval_snapshot_hash" IS NOT NULL
        AND "approved_at" IS NOT NULL
      )
    )
  );

ALTER TABLE "import_tasks"
  ADD COLUMN "structure_fingerprint" VARCHAR(64),
  ADD COLUMN "fingerprint_version" TEXT,
  ADD COLUMN "transform_registry_version" TEXT,
  ADD COLUMN "mapping_profile_id" TEXT,
  ADD COLUMN "mapping_profile_version" INTEGER,
  ADD COLUMN "mapping_profile_snapshot_hash" VARCHAR(64);

CREATE INDEX "import_tasks_structure_fingerprint_idx"
  ON "import_tasks"("structure_fingerprint");
CREATE INDEX "import_tasks_mapping_profile_id_idx"
  ON "import_tasks"("mapping_profile_id");

ALTER TABLE "import_tasks"
  ADD CONSTRAINT "import_tasks_mapping_profile_contract" CHECK (
    ("structure_fingerprint" IS NULL OR "structure_fingerprint" ~ '^[0-9a-f]{64}$')
    AND ("mapping_profile_version" IS NULL OR "mapping_profile_version" >= 1)
    AND ("mapping_profile_snapshot_hash" IS NULL OR "mapping_profile_snapshot_hash" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "mapping_profile_rules"
  ADD COLUMN "source_column_id" TEXT,
  ADD COLUMN "column_index" INTEGER,
  ADD COLUMN "source_inferred_type" TEXT,
  ADD COLUMN "transform_key" TEXT NOT NULL DEFAULT 'IDENTITY_V1';

UPDATE "mapping_profile_rules"
SET
  "source_column_id" = 'legacy:' || "id",
  "column_index" = 0,
  "source_inferred_type" = 'legacy'
WHERE "source_column_id" IS NULL;

ALTER TABLE "mapping_profile_rules"
  ALTER COLUMN "source_column_id" SET NOT NULL,
  ALTER COLUMN "column_index" SET NOT NULL,
  ALTER COLUMN "source_inferred_type" SET NOT NULL;

DROP INDEX "mapping_profile_rules_mapping_profile_id_normalized_source__key";

CREATE UNIQUE INDEX "mapping_profile_rules_mapping_profile_id_source_column_id_key"
  ON "mapping_profile_rules"("mapping_profile_id", "source_column_id");
CREATE INDEX "mapping_profile_rules_mapping_profile_id_normalized_source_idx"
  ON "mapping_profile_rules"("mapping_profile_id", "normalized_source_name");

ALTER TABLE "mapping_profiles"
  ADD CONSTRAINT "mapping_profiles_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_tasks"
  ADD CONSTRAINT "import_tasks_mapping_profile_id_fkey"
  FOREIGN KEY ("mapping_profile_id") REFERENCES "mapping_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
