# CR-032: OCR AI Finance Review Workspace

Commit: `76ef28e feat: add OCR AI finance review workspace`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Change scope

- Connected the OCR detail page to the existing suggestion-history, complete-batch finance-review, review-evidence, revalidation, and approval APIs.
- Added an explicit per-source finance decision workspace for `accept`, `edit`, `reject`, and `ignore`; no decision is selected by default.
- Exposed raw OCR evidence, AI mapping, confidence as advisory metadata, Provider/model/Prompt provenance, final values, reviewer identity, revision, and digest-bound hashes.
- Restored server-side AI suggestion context after refresh without exposing configuration secrets or allowing the browser to construct review provenance.
- Kept the existing manual-correction path available when AI is disabled, unavailable, invalid, or intentionally unused.
- Extended the explicit Mock repository only for local/demo parity; Mock output remains visibly labelled and cannot be represented as real-model evidence.
- Added mobile width constraints for the OCR evidence tables without changing the Friday Demo route or its business workflow.

## Failure evidence

- Before the workspace was implemented, the synthetic API-mode browser test could not find the required `Mock Provider（仅测试）` review context.
- The first complete browser run exposed a teardown foreign-key failure for append-only OCR review evidence; that independent test-isolation defect was fixed and reviewed in CR-031 before this change was accepted.
- The mobile boundary assertion initially found document widths of 775 px and then 449 px on a 390 px viewport. The layout constraints and collapsed-sider transition wait were added; the assertion was retained and now passes.
- Ant Design strict-mode duplicate nodes and pointer interception were resolved by scoping the edit interaction to the amount review row and its visible select control. Assertions were not weakened.

## Verification evidence

All listed commands exited 0:

- `npm run build`: TypeScript project build and Vite production bundle passed.
- `npm run test:runtime`: 4 runtime-configuration tests passed.
- `npm run demo:test`: 1 Friday Excel/report Demo test passed; PostgreSQL setup and guarded cleanup passed.
- `npx playwright test e2e/ocr-workflow.spec.ts`: 2 OCR browser tests passed, including guarded global teardown.
- Targeted API-mode OCR AI handoff test: 1 test passed after the mobile and teardown fixes.
- `npm run check:hygiene`: repository hygiene passed for 813 tracked or candidate files.
- `git diff --check`: passed before commit.
- Staged repository hygiene hook: passed for the 9 committed files.

The new API-mode scenario proves with synthetic input and the explicit Mock Provider that:

- Finance A can generate suggestions, refresh, explicitly review every source, and edit the amount to `1366.66` without creating a formal record.
- The persisted review evidence survives refresh and a handoff to Finance B.
- If the evidence request fails, final approval is disabled; after recovery, Finance B must revalidate and match the same review digest.
- Approval creates exactly one source-linked record, and the approval snapshot carries the same validation/review digest.
- A 390 x 844 viewport has no page-level horizontal overflow after the sider transition completes.

## Security and compatibility

- AI remains advisory and cannot approve or write `BusinessRecord` directly.
- Review save requires the server-issued task version, review revision, AI task ID, output hash, version-vector hash, review-state hash, and review-basis hash.
- Persisted review evidence is fail-closed: load failure, pending decisions, stale validation, or digest mismatch pauses approval.
- Self-approval remains blocked and the second finance user performs the final revalidation/approval in the synthetic workflow.
- No real company file, external Provider, model accuracy, staging environment, owner UAT, or production readiness was asserted.

## Remaining risk

- Real OCR samples and model output still require authorized truth labels and owner review under H04/H05.
- The browser flow validates the local API stack with a Mock Provider; local-model and external-Provider behavior remain separate gated work.
- Owner visual/UAT sign-off has not been performed.
- Remote push remains blocked by the previously recorded GitHub connectivity condition; no force push or history rewrite was attempted.

## Next action

- Audit and close the ReportSnapshot source-detail and AI narrative finance-review gaps while preserving deterministic Decimal metrics and Friday Demo behavior.
