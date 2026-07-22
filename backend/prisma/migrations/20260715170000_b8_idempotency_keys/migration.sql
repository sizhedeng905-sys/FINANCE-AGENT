CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_method" VARCHAR(16) NOT NULL,
    "request_path" TEXT NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'processing',
    "locked_until" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_idempotency_actor_operation_key"
ON "idempotency_keys"("created_by", "request_method", "request_path", "key");

CREATE INDEX "idx_idempotency_status" ON "idempotency_keys"("status");
CREATE INDEX "idx_idempotency_expires" ON "idempotency_keys"("expires_at");
