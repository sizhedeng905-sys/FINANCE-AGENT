ALTER TABLE "work_orders" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "work_orders_idempotency_key_key" ON "work_orders"("idempotency_key");

-- Only work-order sourced records must be globally unique. Manual records intentionally use source_id='manual'.
CREATE UNIQUE INDEX "business_records_work_order_source_key"
ON "business_records"("source_id")
WHERE "source_type" = 'work_order';
