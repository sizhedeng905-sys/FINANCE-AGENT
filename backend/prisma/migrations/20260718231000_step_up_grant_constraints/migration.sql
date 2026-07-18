CREATE UNIQUE INDEX "step_up_grants_active_binding_key"
  ON "step_up_grants"("user_id", "session_id_hash", "action", "resource_type", "resource_id")
  WHERE "status" = 'active';

ALTER TABLE "step_up_grants"
  ADD CONSTRAINT "step_up_grants_revocation_state" CHECK (
    ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    OR ("status" <> 'revoked' AND "revoked_at" IS NULL)
  );
