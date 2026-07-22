# CR-030: OCR AI Review Context Recovery

Commit: `7950b76 fix: restore OCR AI review context`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Change scope

- Extended the existing `GET /api/ocr-tasks/:id/ai-suggestions` history response with the persisted canonical `reviewBasis` needed to resume a finance review after refresh or login change.
- Added a deliberately filtered provenance view containing Provider class/name, model identity, Prompt key/version/content hash, and input/output Schema versions.
- Kept the full AI version vector, Provider configuration, request payload, and secrets outside the response.
- Added PostgreSQL integration assertions that the recovered mapping task carries the same output hash, version-vector hash, review-state hash, and review-basis hash as the original suggestion response.
- No write path, role rule, AI mode, approval policy, Prisma model, or migration changed.

## Red-test evidence

- The first targeted PostgreSQL run failed because history contained neither `reviewBasis` nor provenance, proving that a refreshed page could not reconstruct the server-verified review command.
- The first run after implementation failed because the test used exact nested-object matching while the safe response intentionally contained additional reviewed fields. The assertion was corrected to verify required fields with nested partial matching; no production assertion or security check was removed.

## Verification evidence

- Targeted `ai-ingestion.integration-spec.ts` OCR scenario: 1 passed, 5 name-filtered.
- The guarded integration runner reset only `finance_agent_test`, replayed all 50 migrations, seeded synthetic data, and generated Prisma Client successfully.
- `npm run build` in `backend`: passed.
- `git diff --check` and staged repository hygiene hook: passed.

## Financial and security impact

- Refreshing or switching to another finance login no longer forces the browser to invent review hashes or request a new model execution merely to resume review.
- The recovered data remains read-only and server persisted. Final review submission still revalidates all hashes, current task state, complete source coverage, allowlists, role, and optimistic version.
- AI still cannot approve, validate, or create a `BusinessRecord`.
- Verification used synthetic OCR evidence and Mock Provider output only. It does not establish real OCR accuracy, external Provider approval, owner UAT, or production readiness.

## Rollback and compatibility

- The change is response-additive. Existing clients ignore the new optional properties.
- Rolling back removes refresh recovery metadata but does not alter persisted AI tasks, review decisions, validation snapshots, approvals, or records.

## Next action

- Wire the current OCR detail page to recovered suggestions and persisted review history.
- Require complete finance decisions before saving, invalidate stale validation after review, and fail final approval closed when the canonical review digest cannot be loaded or does not match validation.
- Prove finance A review and finance B approval with a synthetic real-API Playwright scenario.
