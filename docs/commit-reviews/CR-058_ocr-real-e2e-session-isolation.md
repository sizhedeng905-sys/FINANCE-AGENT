# CR-058 Real OCR E2E session isolation

## Symptom

The official real-provider Playwright test completed Paddle OCR, finance correction,
second-finance approval, and record creation, but failed its final record-count query
with a non-2xx response.

## Root cause

The test created an API token for the uploader account `finance`. It later logged that
same account out through the browser before signing in as the second finance user.
Logout correctly increments the account token version, so the original API token
became invalid. The final assertion incorrectly reused that revoked token and received
401.

This was a test session-ownership defect. Weakening logout invalidation would have
turned a correct security behavior into a vulnerability.

## Change

- Create an independent API session for the selected second active finance account.
- Use that account's bearer token for the post-approval record-count query.
- Keep uploader logout, token invalidation, separation of duties, and approval checks
  unchanged.

No product code, database migration, provider configuration, fixture, seed, or
environment variable changed.

## Verification

First execution:

```text
npm run test:e2e:ocr-real
FAIL: final GET /api/records used the uploader token after browser logout.
The task had already created one record; global teardown removed one OCR task,
one record, and one referenced file.
```

After the test-only correction:

```text
npm run test:e2e:ocr-real
PASS: 1/1 in 19.4 seconds.
```

The passing run used the real local Paddle provider, retained zero automatic posting
while the task was pending, required human correction and a different finance account,
then observed exactly one additional record.

## Boundary

- The generated PDF and `finance_agent_test` database contain synthetic data only.
- This verifies provider integration and session-safe E2E behavior, not real invoice
  accuracy.
- The test does not enable external AI/OCR providers or weaken token revocation.

## Rollback

Revert this commit. Product behavior is unaffected, but the real OCR E2E will again
query with a deliberately revoked uploader token and fail after successful approval.
