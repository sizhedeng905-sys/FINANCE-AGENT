-- Existing review rows predate canonical review-basis tokens, so the new columns
-- remain nullable. New application writes always populate both hashes.
ALTER TABLE "import_ai_review_decisions"
ADD COLUMN "review_state_hash" VARCHAR(64),
ADD COLUMN "review_basis_hash" VARCHAR(64);

ALTER TABLE "import_ai_review_decisions"
ADD CONSTRAINT "import_ai_review_decisions_review_state_hash_check"
CHECK ("review_state_hash" IS NULL OR "review_state_hash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "import_ai_review_decisions_review_basis_hash_check"
CHECK ("review_basis_hash" IS NULL OR "review_basis_hash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "import_ai_review_decisions_review_hash_pair_check"
CHECK (("review_state_hash" IS NULL) = ("review_basis_hash" IS NULL));

CREATE INDEX "import_ai_review_decisions_review_basis_hash_idx"
ON "import_ai_review_decisions"("review_basis_hash");
