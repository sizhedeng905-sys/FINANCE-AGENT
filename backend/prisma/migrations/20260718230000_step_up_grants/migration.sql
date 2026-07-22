ALTER TYPE "RetentionDataClass" ADD VALUE 'auth_security_grant';

CREATE TYPE "StepUpGrantStatus" AS ENUM ('active', 'consumed', 'revoked');

CREATE TABLE "step_up_grants" (
  "id" TEXT NOT NULL,
  "token_id_hash" VARCHAR(64) NOT NULL,
  "user_id" TEXT NOT NULL,
  "session_id_hash" VARCHAR(64) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "resource_type" VARCHAR(100) NOT NULL,
  "resource_id" VARCHAR(256) NOT NULL,
  "role_snapshot" "UserRole" NOT NULL,
  "token_version" INTEGER NOT NULL,
  "status" "StepUpGrantStatus" NOT NULL DEFAULT 'active',
  "max_uses" INTEGER NOT NULL DEFAULT 1,
  "use_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "step_up_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "step_up_grants_single_use" CHECK ("max_uses" = 1),
  CONSTRAINT "step_up_grants_use_count" CHECK ("use_count" BETWEEN 0 AND 1),
  CONSTRAINT "step_up_grants_consumed_state" CHECK (
    ("status" = 'consumed' AND "use_count" = 1 AND "consumed_at" IS NOT NULL)
    OR ("status" <> 'consumed' AND "use_count" = 0 AND "consumed_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "step_up_grants_token_id_hash_key" ON "step_up_grants"("token_id_hash");
CREATE INDEX "step_up_grants_user_id_status_expires_at_idx"
  ON "step_up_grants"("user_id", "status", "expires_at");
CREATE INDEX "step_up_grants_action_resource_type_resource_id_idx"
  ON "step_up_grants"("action", "resource_type", "resource_id");

ALTER TABLE "step_up_grants"
  ADD CONSTRAINT "step_up_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
