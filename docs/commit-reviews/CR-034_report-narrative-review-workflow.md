# CR-034: Report Narrative Review Workflow

Code commit: `ae59fe1 feat: add report narrative review workflow`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / OQ03_POLICY_PENDING / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Goal

Add a fail-closed, append-only review workflow for AI-generated report text without allowing any review command to update the immutable `ReportSnapshot`, grounded claims, `BusinessRecord`, or Decimal metrics.

Because owner question OQ-03 has not selected a final product workflow, the server default remains `REPORT_NARRATIVE_REVIEW_MODE=disabled`. The only implemented opt-in mode is the conservative finance-then-boss sequence; there is no boss-only, auto-accept, or client-selected mode.

## Prior gap and failure evidence

- A generated Narrative carried the immutable AI output status `NEEDS_FINANCE_REVIEW`, but there was no persisted review event, server-derived reviewer stage, optimistic version, or final accepted-text state.
- The first targeted unit run failed one suite at TypeScript compilation because the derived-state accumulator was inferred as the initial enum literal. The accumulator was explicitly typed as the complete review-status enum; the same command then passed `2 suites / 81 tests`.
- The implementation was not preceded by a separate committed expected-failure test. This review does not represent that absent test as evidence.

## Change scope

- Added append-only `ReportNarrativeReviewDecision` facts with finance/boss stage, command, before/after status, review version, mandatory reason, actor snapshot, timestamp, database transition checks, and immutable update/delete trigger.
- Kept the generated Narrative and Claim rows immutable. Review state is derived from ordered events rather than mutating the AI output row.
- Added paginated pending-review reads and a command endpoint. Stage, actor, status, and transition are derived by the server; the client cannot submit a target status or reviewer identity.
- Required expected review version, Narrative hash, and Snapshot hash on every command. A PostgreSQL advisory transaction lock makes concurrent review commands single-winner.
- Re-read active account and role inside the final transaction, then wrote the review event and audit log atomically.
- Added strict, trimmed reason validation (`2..500` characters, no control characters).
- Added a server configuration contract with only `disabled | finance_then_boss`; missing values fail closed to `disabled`, and invalid values fail application startup validation.
- Extended guarded E2E cleanup to delete review facts only inside the existing transaction-local report-audit maintenance gate.

## Schema and API impact

- Migration: `20260722140000_report_narrative_review_events`.
- New enums: `ReportNarrativeReviewStatus`, `ReportNarrativeReviewStage`, and `ReportNarrativeReviewCommand`.
- New table: `report_narrative_review_decisions`, with unique Narrative/version and Narrative/stage constraints plus append-only trigger protection.
- `GET /api/ai/report-narratives?page=&pageSize=`: finance receives unreviewed Narratives; boss receives finance-accepted Narratives awaiting boss review.
- `GET /api/ai/report-narratives/:id`: remains read-only and is now available to finance and boss.
- `POST /api/ai/report-narratives/:id/review`: accepts only expected hashes/version, `ACCEPT | REQUEST_CHANGES | REJECT`, and a reason.
- Existing Narrative responses add derived `review.status`, `review.version`, current policy, and immutable history.

## Verification evidence

All commands listed as passed exited `0`:

- Targeted backend unit: `2 suites / 81 tests` passed after the recorded compile fix.
- Full backend unit: `51 suites / 473 tests` passed.
- Backend build: Prisma generate plus both TypeScript builds passed.
- PostgreSQL report integration: `1 suite / 1 test` passed after reset, seed, and all `51` migrations.
- Migration dual path: empty database applied `51` migrations; baseline database applied `50` then upgraded with migration `51`; schema verification found no missing or unexpected application tables.
- Prisma validate: passed.
- Demo configuration: `6/6` passed.
- `demo:reset` and `demo:verify`: passed against loopback `finance_agent_test`.
- Friday Demo Playwright: `1/1` passed with exactly `3` published records and total `13,422.21`; cleanup completed.
- Repository hygiene: passed for `821` tracked or candidate files.
- `git diff --check` and staged hygiene: passed.
- Frontend production build for a review UI: `NOT_RUN`, because this commit does not add that UI.
- Remote push and same-SHA CI: `BLOCKED_EXTERNAL`; no remote success is claimed.

The PostgreSQL assertions cover disabled-policy failure, employee 403, finance pending visibility, boss out-of-order rejection, malformed reason rejection, Narrative-hash mismatch, two concurrent finance accepts with exactly one success, stale replay rejection, boss final acceptance, two atomic audit events, immutable review update/delete rejection, and unchanged Narrative JSON/hash, Claim count, Snapshot count, and BusinessRecord count.

## Financial and security impact

- Review events classify only AI-generated text. They have no write path to Snapshot, Claim, record, amount, currency, or report calculation services.
- The AI-generated `decision=NEEDS_FINANCE_REVIEW` remains immutable evidence of model output; accepted/rejected workflow interpretation is separate and auditable.
- Database constraints cover sequence shape, version/stage, reason format, uniqueness, foreign keys, and append-only storage. Service logic additionally covers current-account authorization, expected hashes, and current derived state.
- The global role model still has no project-membership ACL. This change does not claim tenant-level project isolation beyond existing finance/boss access.

## Rollback

- Set `REPORT_NARRATIVE_REVIEW_MODE=disabled` for immediate fail-closed rollback without data loss.
- Revert code commit `ae59fe1` to remove API behavior. The additive table and enums may remain inert; a production down migration was intentionally not introduced.
- Do not drop review facts in an operational database without a separately reviewed retention/migration decision.

## Remaining limits

- The finance/boss browser workspaces are not yet connected to these endpoints, so unreviewed text must continue to be shown only as a draft.
- OQ-03 remains a product-policy decision. The conservative opt-in sequence is an engineering framework, not final owner approval.
- No real financial truth set, real-model narrative quality, owner UAT, target environment, or production release is proven.

## Next action

Connect role-specific finance and boss review workspaces to the persisted API, keep all unaccepted text visibly marked as draft, add API-mode Playwright coverage for refresh/handoff/conflict behavior, and rerun the full report and Friday Demo gates.
