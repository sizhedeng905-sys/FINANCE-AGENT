# CR-029: OCR AI Review Digest Binding

Commit: `86abfcf fix: bind OCR approvals to review digest`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Change scope

- Added canonical `ocr-ai-review-digest/1.0` generation over all immutable OCR AI review decisions for a task.
- The digest revalidates each referenced AI task status, input/output/version hashes, canonical version vector, review basis, resource identity, review-state identity, Provider/Prompt/Schema facts, warnings, and raw/suggested/final evidence before hashing the review history.
- The paginated review endpoint now returns rows, filtered summary, and the task-wide canonical digest from one PostgreSQL `RepeatableRead` snapshot.
- Deterministic OCR revalidation freezes the digest in `ocr-validation/1.1`; final approval recomputes it inside the locked transaction and rejects any mismatch with `OCR_AI_REVIEW_DIGEST_STALE`.
- The immutable approval contract is now `ocr-approval/1.1`. It freezes the full digest summary and digest hash in the approval snapshot, record confirmation snapshot, audit logs, and ledger events.
- Pure manual OCR paths use the same contract with `mode: manual`, zero decisions, and a deterministic digest. AI remains advisory and `appliedToFormalData` remains false.
- No Prisma model or database migration changed. The version bump applies only to JSON contracts. Existing unapproved 1.0 validation snapshots fail closed and require revalidation; historical confirmed snapshots are not rewritten.

## Red-test evidence

- The first PostgreSQL assertion failed because `validation.snapshot.aiReview` was undefined. This proved that CR-028 review evidence was not yet frozen by deterministic validation or approval.
- A controlled test-maintenance replacement of an immutable review reason after revalidation originally had no approval-level assertion. The new attack now returns HTTP 409 with `OCR_AI_REVIEW_DIGEST_STALE` and leaves formal record count at zero.
- The first related unit command stopped before running `ocr.spec.ts` because its direct `OcrTasksService` construction lacked the new digest dependency. The test harness was updated and then all 28 related tests executed successfully; the stopped run is not counted as a pass.

## Verification evidence

- `npm run build` in `backend`: passed after the final provenance relationship checks.
- `npx jest --runInBand test/ocr.spec.ts test/ocr-ir.spec.ts test/ai-ingestion-boundary.spec.ts test/ai-suggestion-validator.spec.ts`: 4 suites, 28 tests passed.
- Full `ai-ingestion.integration-spec.ts`: 1 suite, 6 tests passed after digest binding. After the final basis/vector cross-field hardening, the targeted OCR scenario passed again: 1 passed, 5 name-filtered.
- Targeted OCR AI PostgreSQL flow proves: persisted digest matches list digest; maintenance tampering blocks approval; formal record count remains zero on failure; restored evidence plus a new manual revision/revalidation permits a different finance account to create exactly one record; validation, approval, and confirmation digest hashes match.
- Targeted legacy manual OCR PostgreSQL flow: 1 passed, 76 name-filtered. It proves `mode: manual`, warning acknowledgement, correction, two-finance concurrency, idempotent replay, one formal record, and `ocr-approval/1.1` remain functional.
- Each PostgreSQL run reset only guarded local `finance_agent_test` and replayed all 50 migrations successfully.
- `git diff --check`, staged scope review, and repository hygiene hook: passed.

## Financial and security impact

- A finance user cannot approve a validation snapshot while the underlying AI review history, AI task, version vector, output, review basis, or evidence relationship has changed.
- Formal amounts remain derived by deterministic Decimal and record-policy code. The digest adds provenance binding but gives AI no calculation, approval, or write authority.
- The uploader/self-approval restriction and current-account finance authorization remain enforced at final commit.
- Verification used synthetic OCR IR, Mock Provider output, and local test accounts only. It does not establish real OCR accuracy, production readiness, or owner UAT.

## Rollback and compatibility

- Rolling code back would make newly created 1.1 validation snapshots unreadable to the old approval code and should therefore be paired with explicit revalidation after roll-forward. No database rollback is needed.
- Existing confirmed 1.0 snapshots remain historical facts. Pending 1.0 snapshots intentionally require revalidation under the safer contract.

## Next action

- Wire the finance OCR review workspace to the real suggestion/review/history APIs, render raw/AI/final evidence and digest provenance, and fail approval closed when evidence cannot be loaded.
- Add synthetic real-API Playwright coverage for finance A review, finance B evidence inspection, deterministic revalidation, approval, and exact record/Snapshot consistency.
