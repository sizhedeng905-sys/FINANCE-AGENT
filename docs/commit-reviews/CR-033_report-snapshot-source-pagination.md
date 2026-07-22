# CR-033: Report Snapshot Source Pagination

Commit: `b7721db feat: expose paginated report snapshot sources`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Goal

Connect the existing immutable `ReportSnapshotSource` records to the boss report page with server-side pagination and filters, while proving that the displayed evidence belongs to the exact snapshot and does not recalculate or mutate financial facts.

## Failure reproduction

- The first PostgreSQL test run exited 1 after replaying all 50 migrations.
- The existing source endpoint returned rows and pagination but omitted the snapshot hash, source digest, consistency watermark, source count, and frozen project name required to bind the browser view to the immutable snapshot.
- Browser filter coverage initially failed on Ant Design's duplicate/virtual accessibility nodes and icon-prefixed button name. The product selection was visible and correct; locators were narrowed to the visible dropdown and the source region without weakening response assertions.

## Root cause

- `/api/reports/snapshots/:id/sources` had been implemented as a low-level paginated row query, but no immutable snapshot metadata accompanied the response.
- The boss report page generated a snapshot and narrative but never called the existing source endpoint.
- The source query DTO had pagination only, so the UI could not safely request bounded project/currency/direction subsets.

## Change scope

- Added validated `projectId`, uppercase ISO-style `currency`, and `accountingDirection` filters to the existing source endpoint.
- Kept stable ordering by `recordDate, recordId` and server-side `page/pageSize` with the existing maximum of 100.
- Added response metadata for `snapshotId`, `snapshotHash`, `sourceDigest`, `dataWatermark`, and frozen `sourceCount`.
- Resolved project names from immutable canonical snapshot breakdowns rather than current mutable project rows.
- Added typed frontend API and explicit Mock parity; Mock rows remain synthetic and the enclosing snapshot warning remains visible.
- Added a read-only boss-page evidence section with filters, paginated rows, amount/currency, direction, record version, safe hash abbreviation/copy, source digest, and consistency watermark.
- The browser rejects a source response whose snapshot ID/hash/digest does not match the currently displayed snapshot.

## Schema and API impact

- Database migration: none.
- Existing immutable snapshot/source tables: unchanged.
- API: `GET /api/reports/snapshots/:id/sources` adds optional filters and additive response metadata/project name.
- Authorization remains the existing server-side `finance | boss` role gate; employee access is verified as 403.

## Verification evidence

All green commands exited 0:

- PostgreSQL integration: `1 suite / 1 test` passed after a guarded reset, seed, and replay of all `50` migrations.
- Frontend production build: passed (`3153` modules transformed).
- Backend build, Prisma generate, and TypeScript builds: passed.
- API-mode Playwright core workflow: `1/1` passed; source load, digest binding, UI visibility, and `expense` filter request/response were asserted; teardown removed all created artifacts.
- Runtime configuration tests: `4/4` passed.
- Demo configuration tests: `6/6` passed.
- `demo:reset`: passed against loopback `finance_agent_test` only.
- `demo:verify`: passed.
- Friday Demo: `1/1` passed with exactly `3` records and deterministic total `13,422.21`; teardown left no file artifacts.
- Repository hygiene: passed for `815` tracked or candidate files.
- `git diff --check` and staged hygiene: passed.

PostgreSQL assertions include stable repeated-page ordering, page boundaries, project/currency/direction filters, invalid currency/direction rejection, employee 403, 64-character record hashes, frozen project names, and snapshot watermark/hash/digest binding.

## Financial and security impact

- Source expansion is read-only and cannot alter Snapshot, Claim, BusinessRecord, Decimal metrics, approval state, or Narrative.
- Project names and source evidence are read from the frozen snapshot/source facts, avoiding display drift after later project edits.
- Filters are DTO-whitelisted and translated to fixed Prisma fields; no arbitrary field, SQL, or sort expression is accepted.
- Full hashes remain copyable while the table uses safe abbreviated display.
- The existing single-organization role model has no finer project-membership ACL. This change does not claim project-scoped multi-tenant isolation beyond the current finance/boss policy.

## Rollback

- Revert `b7721db`; no database rollback is needed.
- The prior snapshot creation, deterministic metrics, grounded Narrative, and Friday Demo paths remain independently available.

## Remaining limits

- Owner visual/UAT sign-off is not run.
- Real business reconciliation and formal metric policy remain governed by H06/H08.
- Remote push/CI evidence remains blocked by the recorded GitHub connectivity condition.

## Next action

- Add a fail-closed, append-only finance review state for AI report Narrative text without allowing any review action to mutate Snapshot, Claim, BusinessRecord, or Decimal results.
