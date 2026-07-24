# CR-057 OCR field-key label bridge

## Goal

Allow the local PaddleOCR adapter to recognize a server-controlled stable field key
when a synthetic or bilingual document uses that key as its exact label. The result
must remain low-confidence evidence for AI suggestion and finance review, not an
automatic accounting decision.

## Reproduction

The local provider correctly extracted these PDF lines:

```text
date: 2026-07-24
expenseReason: Office supplies reimbursement
costCategory: office supplies
amount: 1280.50
payee: Temporary Office Supplier
```

The active reimbursement template used Chinese field names and aliases. The adapter
only compared OCR labels with those display names and aliases, so the English labels
produced no field candidates. The OCR AI service then returned
`NO_TRACEABLE_OCR_VALUE`, correctly creating no business record.

## Root cause

`templateFields` already carried `fieldKey`, but deterministic candidate extraction
did not include it in the exact-label allowlist. The older live adapter acceptance
did not expose this mismatch because its test field used `fieldName: "amount"`.

## Change

- Add the server-controlled `fieldKey` after field name and configured aliases in the
  deterministic label list.
- Normalize and de-duplicate labels before matching.
- Keep matching anchored to a complete label followed by an allowed separator,
  whitespace value, or same-page adjacent line.
- Keep confidence below `0.8`, so every result remains visibly low-confidence and
  requires finance review.
- Add a negative assertion proving `subtotal amount` cannot match the `amount` key.

No database migration, API contract, template data, approval policy, or final record
write path changed.

## Verification

```text
python -m unittest discover -s deploy/model-services/paddle-ocr-adapter/tests -p "test_*.py" -v
PASS: 10 discovered; 7 passed; 3 health tests skipped because host FastAPI
dependencies are not installed.

docker compose --env-file .env -f deploy/model-services/compose.yaml build paddle-ocr
PASS: image build ran all 10 adapter tests successfully.

npm --prefix backend run model:ocr:acceptance
PASS: pages=1, candidates=1, textChars=40.

npx playwright test .realdata-test/live-local-ingestion.spec.ts \
  --config .realdata-test/playwright.live.config.ts \
  --grep "live Paddle and Qwen"
PASS: 1/1 in 17.1 seconds.
```

The ignored local browser evidence used only a generated PDF and the isolated
`finance_agent_pilot_test` database:

- Paddle provider: `local_paddle`, model `PaddlePaddle/PaddleOCR-VL`;
- Qwen provider: `openai_compatible`, model `Qwen/Qwen3-14B-AWQ`;
- six text mappings retained page and bbox evidence;
- the uploader account `finance` could not approve its own task;
- the separate Chinese finance account revalidated and approved;
- review revision advanced to `1`;
- exactly one confirmed record was generated with amount `1477.77`;
- audit and ledger events were present.

An intentionally ambiguous sample containing `transport` selected the transport
template and produced a duplicate `remark` target. Strict mapping validation rejected
it and returned to manual review with zero records. This is retained as fail-closed
evidence rather than weakened to make the test green.

## Security and data boundary

- `fieldKey` originates from the authenticated server-side template snapshot; the
  client or document cannot add an arbitrary target field.
- The adapter still returns evidence candidates only. AI cannot approve or write a
  `BusinessRecord`.
- Unknown, partial, conflicting, or duplicate labels remain unmapped or fail closed.
- No real company file, external provider, secret, token, or production database was
  used.
- This synthetic run does not establish real invoice accuracy or production
  readiness.

## Rollback

Revert this commit. Existing Chinese field-name and configured-alias matching remains
available, while English stable-key labels return to explicit manual review.
