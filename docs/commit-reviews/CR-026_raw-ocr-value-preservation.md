# CR-026: Raw OCR Value Preservation

Commit: `5c09b48 fix: preserve raw OCR values during correction`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Problem and red reproduction

- The correction path replaced `fieldCandidates.rawValue` with the finance-entered value.
- A PostgreSQL workflow test captured the original provider value and then corrected the same field.
- Before the fix, the assertion failed because the raw date changed from `2026-07-22` to `2026-07-01`.
- This destroyed the direct raw-OCR-to-human-final comparison required by the evidence chain.

## Change scope

- Manual correction no longer writes `rawValue`.
- `rawValue` remains the immutable provider observation, including `null` when OCR found no value.
- `normalizedValue` remains the current deterministic value used by validation and eventual approval.
- `OcrCorrection` continues to store before value, after value, reason, evidence refs, actor, and review revision.
- No API shape, migration, provider, frontend mode, or Friday Demo configuration changed.

## Verification evidence

- Red PostgreSQL workflow: 1 failed; original raw value was overwritten.
- Green PostgreSQL workflow: 1 passed, 76 name-filtered tests skipped, 7.767 s Jest time.
- The passing workflow includes correction, validation invalidation, revalidation, warning acknowledgement, separate-finance approval, idempotent confirmation, and retry behavior.
- `npx jest --runInBand test/ocr.spec.ts test/ocr-ir.spec.ts`: 2 suites and 11/11 tests passed.
- `npm run build` in `backend`: passed, including Prisma generate and TypeScript builds.
- Repository staged hygiene hook: passed.

## Data integrity impact

- Future corrections preserve the raw/provider evidence independently from the human final value.
- Approval and record generation still consume the normalized candidate value after deterministic validation.
- No attempt is made to guess or silently backfill raw values already overwritten by historical executions. Such data requires evidence-IR or source-file reconstruction under an explicit migration decision.

## Limits and next action

- Verification uses Mock OCR and synthetic files; real receipt accuracy remains `REAL_SAMPLE_NEEDED`.
- The next P1-C step is immutable, complete-batch OCR AI review persistence linking source evidence, AI output/basis, finance decision, final value, actor, and revision.
- GitHub push remains `REMOTE_PUSH_BLOCKED_EXTERNAL` based on the previously recorded bounded failures.
