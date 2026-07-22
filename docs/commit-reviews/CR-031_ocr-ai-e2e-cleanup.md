# CR-031: OCR AI E2E Cleanup

Commit: `a3c8de2 test: clean immutable OCR review fixtures`

## Review conclusion

Status: `LOCAL_ENGINEERING_VERIFIED / TEST_DATABASE_ONLY / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Change scope

- Extended the existing guarded E2E cleanup script to discover OCR-scoped AI tasks.
- Inside the existing transaction, enabled the database maintenance flag required to purge append-only OCR AI review fixtures.
- Deleted OCR review decisions before their protected parent task, then removed the now-unreferenced OCR AI tasks.
- Included OCR AI task IDs in audit/ledger cleanup scope and cleanup counts.
- No production endpoint, runtime service, schema, migration, or normal append-only rule changed.

## Failure evidence

- The new OCR AI browser workflow completed all business assertions, but Playwright global teardown exited 1 because `ocrTask.deleteMany()` hit the review evidence foreign-key restriction.
- This showed that the old cleanup order had not evolved with the append-only review model. The successful browser test was not counted as a green command until teardown also passed.

## Verification evidence

- Targeted synthetic real-API Playwright after the fix: 1 test passed and global teardown passed.
- Full `e2e/ocr-workflow.spec.ts` after the fix: 2 browser tests passed; teardown removed 2 OCR tasks, 2 records, 4 ingestion AI tasks, 2 files, and zero orphan file artifacts.
- The cleanup script retained its hard guard requiring a database name ending in `_test`.
- Staged repository hygiene hook: passed.

## Security and compatibility

- The purge override remains transaction-local and is unreachable through application APIs.
- Production OCR review evidence remains append-only and parent deletion remains restricted.
- Existing Excel, report, work-order, mapping-profile, and file cleanup ordering is unchanged.

## Next action

- Commit the OCR finance review workspace and its synthetic real-API handoff/approval evidence separately.
