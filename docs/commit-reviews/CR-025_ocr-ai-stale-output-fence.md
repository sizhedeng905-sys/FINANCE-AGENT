# CR-025: OCR AI Stale Output Fence

Commit: `d11fb0f fix: reject stale OCR AI suggestion output`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Problem and red reproduction

- An OCR task could change after the mapping provider returned but before the API assembled its review response.
- Before the fix, a synthetic PostgreSQL race incremented the task version after the second provider call and the API still returned `needs_finance_review`.
- The red test failed 1/1 as expected. No `BusinessRecord` was created, but the stale suggestion remained visible as current review input.

## Change scope

- Added the versioned `ocr-ai-review-state/1.0` state contract.
- Bound classification and mapping invocations to the same canonical task, project, source, evidence, template-candidate, review, and validation state hash.
- Added a final database reload after mapping completion. A missing, blocked, or changed state now returns `SUGGESTION_OUTPUT_STALE` and preserves the completed AI execution only as audit evidence.
- Added `reviewRevision`, `validationRevision`, and `validationSnapshotHash` to the canonical OCR suggestion state.
- No migration, OCR provider, business-record writer, Demo configuration, or real-data path changed.

## Verification evidence

- Red PostgreSQL test: 1 failed; stale provider output incorrectly returned `needs_finance_review`.
- Green PostgreSQL test: 1 passed, 5 name-filtered tests skipped, 5.716 s Jest time.
- `npm run build` in `backend`: passed, including Prisma generate and TypeScript builds.
- `npx jest --runInBand test/ai-ingestion-boundary.spec.ts`: 3/3 passed.
- Repository staged hygiene hook: passed for the two code/test files.

## Security and financial impact

- A suggestion no longer survives concurrent correction, validation, task-version, source, project, or template-candidate changes.
- AI remains advisory and cannot confirm an OCR task or create a `BusinessRecord`.
- Provider output and its immutable review basis remain available for audit without being presented as current evidence.

## Limits and next action

- The proof uses a Mock provider, synthetic OCR IR, and the dedicated PostgreSQL test database. It does not establish real invoice accuracy, GPU throughput, or production readiness.
- The remaining P1-C gap is immutable per-field linkage among raw OCR evidence, AI suggestion, finance decision, final value, reason, actor, and revision.
- GitHub push remains `REMOTE_PUSH_BLOCKED_EXTERNAL` after the previously recorded bounded retries; this commit is local evidence only.
