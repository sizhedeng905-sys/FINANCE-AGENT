ALTER TABLE "work_orders"
  ALTER COLUMN "occurred_date" DROP NOT NULL;

ALTER TABLE "work_orders"
  RENAME COLUMN "idempotency_key" TO "approval_idempotency_key";

ALTER INDEX "work_orders_idempotency_key_key"
  RENAME TO "work_orders_approval_idempotency_key_key";

ALTER TABLE "work_orders"
  ADD COLUMN "creation_idempotency_key" TEXT;

CREATE UNIQUE INDEX "work_orders_creation_idempotency_key_key"
  ON "work_orders"("creation_idempotency_key");
