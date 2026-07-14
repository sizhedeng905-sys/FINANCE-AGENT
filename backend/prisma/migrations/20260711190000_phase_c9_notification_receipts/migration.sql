CREATE TABLE "notification_receipts" (
  "id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_receipts_notification_id_user_id_key"
  ON "notification_receipts"("notification_id", "user_id");
CREATE INDEX "notification_receipts_user_id_read_at_idx"
  ON "notification_receipts"("user_id", "read_at");

ALTER TABLE "notification_receipts"
  ADD CONSTRAINT "notification_receipts_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_receipts"
  ADD CONSTRAINT "notification_receipts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "notification_receipts" ("id", "notification_id", "user_id", "read_at", "created_at")
SELECT
  'legacy_' || md5(n."id" || ':' || u."id"),
  n."id",
  u."id",
  COALESCE(n."read_at", n."created_at"),
  COALESCE(n."read_at", n."created_at")
FROM "notifications" n
JOIN "users" u
  ON u."id" = n."target_user_id"
  OR (n."target_user_id" IS NULL AND u."role" = n."target_role" AND u."status" = 'active')
WHERE n."read" = true
ON CONFLICT ("notification_id", "user_id") DO NOTHING;
