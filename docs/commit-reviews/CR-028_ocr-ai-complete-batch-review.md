# CR-028: Complete-batch OCR AI Finance Review

Commit: `d812e99 feat: persist complete OCR AI reviews`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / APPROVAL_DIGEST_PENDING / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Change scope

- Added finance-only `PUT /api/ocr-tasks/:id/ai-reviews` and paginated `GET /api/ocr-tasks/:id/ai-reviews` endpoints.
- A review command must cover every source in the current OCR evidence set exactly once with `accept`, `edit`, `reject`, or `ignore`.
- The server reloads and verifies the current task/review revision, latest successful AI task, canonical output hash, version-vector hash, review-state hash, review-basis hash, template/field allowlist, transform registry, complete source coverage, and evidence references.
- `accept` derives the target and value from the persisted AI suggestion. `edit` requires an actual human change. `reject` retains the original OCR mapping. `ignore` clears the source candidate. Client-selected values are rejected for non-edit decisions.
- Raw OCR values remain unchanged. Human-reviewed normalized values, immutable `OcrAiReviewDecision` evidence, correction traces, audit log, and ledger event are committed in one serializable transaction.
- Every successful review creates a new review revision and invalidates the previous validation snapshot. It creates zero `BusinessRecord` rows.
- Added a forward-only migration allowing the existing correction audit table to represent the four AI review decision types without changing any published migration.
- Extracted the deterministic OCR value normalizer so manual correction and AI-assisted finance review use the same Decimal/date/file/text rules.

## Red-test evidence

- Before the review route was wired, the complete-batch API test returned HTTP 404.
- The first valid write then exposed the old `ocr_corrections_override_type_check`, which accepted only `MANUAL_OVERRIDE`; the request failed instead of silently dropping correction evidence. The new forward migration closes that schema mismatch.
- Two concurrent submissions initially produced statuses `[200, 500]`: PostgreSQL rolled back the loser, but Prisma serialization conflict `P2034` escaped as an internal error.
- The service now maps only `P2034` and PostgreSQL `40001`/`40P01` transaction conflicts to a retryable unified HTTP 409. The same attack now deterministically produces `[200, 409]` and one evidence batch.
- An initial name-filter command prepared the test database but matched no test (`0 executed / 6 skipped`); it is intentionally not counted as passing behavior evidence.

## Verification evidence

- `npm run build` in `backend`: passed, including Prisma generate and both TypeScript builds.
- `npx jest --runInBand test/ocr.spec.ts test/ocr-ir.spec.ts test/ai-ingestion-boundary.spec.ts test/ai-suggestion-validator.spec.ts`: 4 suites, 28 tests passed.
- `npm run test:integration -- test/integration/ai-ingestion.integration-spec.ts`: 1 suite, 6 tests passed. This includes tampered/stale/incomplete payload rejection, complete-batch semantics, concurrent single-winner behavior, reject/ignore, deterministic revalidation failure, access control, pagination, and zero formal records.
- `npm run test:integration -- test/integration/postgres.integration-spec.ts -t "runs OCR through human correction"`: 1 test passed and 76 were name-filtered, proving the existing manual OCR correction/confirmation path still works.
- The integration runner reset only the guarded local `finance_agent_test` database and successfully replayed all 50 migrations before each PostgreSQL run.
- `npx prisma validate`: passed.
- `git diff --check` and the staged repository hygiene hook: passed.

## Security and data-integrity boundary

- The API derives the actor from the bearer token and accepts only the finance role. A synthetic employee request received HTTP 403.
- A complete source universe, strict output contract, server-side field/transform allowlists, evidence ownership, optimistic revision, row lock, and serializable transaction prevent partial, stale, cross-task, and concurrent review writes.
- Provider output still cannot approve or create formal business records. All AI decisions remain advisory until a finance user explicitly reviews every source and a later approval command passes deterministic validation.
- Verification used only synthetic fixtures and Mock Provider behavior. It does not establish real OCR accuracy, real finance correctness, production retention, or owner UAT.

## Residual risk and next action

- The frontend finance review workspace has not yet called these endpoints or displayed the immutable raw/suggested/final evidence chain.
- OCR revalidation and final approval do not yet freeze and compare a canonical digest of the applied AI review decisions. That binding must be implemented before the reviewed values can be claimed as approval-provenance complete.
- The latest local commits have not received same-SHA remote CI evidence because GitHub connectivity was already classified as `REMOTE_PUSH_BLOCKED_EXTERNAL`; no force push or repeated network retry was performed in this step.
