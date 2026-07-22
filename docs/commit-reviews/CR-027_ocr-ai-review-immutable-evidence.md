# CR-027: Immutable OCR AI Review Evidence

Commit: `f31c9f2 feat: add immutable OCR AI review evidence`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / API_NOT_YET_WIRED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Change scope

- Added `OcrAiReviewDecision` as a narrow audit extension of existing `OcrTask`, `AiTask`, field, user, and review-revision entities.
- The row freezes raw OCR value/evidence, AI task and hashes, canonical review state/basis, suggested mapping/value/evidence, human final mapping/value/evidence, decision, reason, actor, and revision.
- Added unique constraints for one source decision per task revision and one review per AI-output source.
- All parent foreign keys use `RESTRICT` so deleting a task, AI execution, field, or actor cannot silently erase review evidence.
- A database trigger rejects UPDATE and DELETE. Transaction-local `app.allow_ocr_ai_review_purge=on` permits DELETE only for explicit test/maintenance cleanup; UPDATE remains forbidden.
- This commit does not add or claim a review API, UI, automatic approval, or business-record write path.

## Verification evidence

- `npx prisma validate`: passed.
- Empty dedicated PostgreSQL test database: all 49 migrations applied successfully, including `20260722130000_ocr_ai_review_provenance`.
- Targeted PostgreSQL attack test: 1 passed, 5 name-filtered tests skipped, 5.692 s Jest time.
- Assertions covered duplicate source rejection, UPDATE rejection, ordinary DELETE rejection, referenced `AiTask` deletion rejection, transaction-local maintenance cleanup, GUC non-leakage, and zero `BusinessRecord` creation.
- `npm run build` in `backend`: passed, including Prisma generate and TypeScript builds.
- Repository staged hygiene hook: passed.

## Development database status

- `npx prisma migrate status` returned exit code 1 for local `finance_agent_dev` because 25 migrations, beginning at `20260718170000_import_preview_summary_version`, are not applied there.
- No migration was applied to that development database in this step. Its data was not reset, altered, or treated as acceptance evidence.
- Existing-database upgrade and backup/restore evidence remains a deployment gate; empty-test-database success does not replace it.

## Security boundary and residual risk

- The append-only trigger protects normal application writes and accidental parent cascades.
- A principal with arbitrary SQL rights could set the maintenance GUC inside its own transaction. Production database-role separation and migration/operator controls remain required under H13/H16.
- Real OCR accuracy, evidence quality, and production retention remain `REAL_SAMPLE_NEEDED` or pending human/deployment gates.

## Next action

- Wire a complete-batch finance review command that revalidates the latest successful AI task, hashes, review basis, source universe, evidence refs, field allowlist, and optimistic task/review revision before writing these rows.
- Deterministically apply accept/edit/reject/ignore outcomes to the existing OCR candidate revision, invalidate validation, audit the command, and still create zero business records.
