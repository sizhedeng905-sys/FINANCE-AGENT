# CR-035: Report Narrative Review Workspaces

Code commit: `ad3e28f feat: connect report narrative review workspaces`

## Review conclusion

Status: `SYNTHETIC_ENGINEERING_VERIFIED / OQ03_POLICY_PENDING / REAL_MODEL_QUALITY_NOT_TESTED / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL`

## Goal

Connect the append-only CR-034 Narrative review API to finance and boss browser workspaces while making every non-accepted AI text visibly remain a draft. The browser must send commands against server hashes and versions, never construct reviewer identity, role, target status, or a local approval fact.

## Failure reproduction

The first API-mode Playwright run failed `1/1` after the backend returned `review.status=NEEDS_FINANCE_REVIEW`. The boss page could not find `草稿 · 待财务复核` because it still rendered the earlier static `需财务复核` tag and had no persisted finance/boss review workspace. Guarded teardown removed the synthetic work order, record, Snapshot, and Narrative artifacts after the failure.

## Change scope

- Added shared, role-aware Narrative evidence and review components used by both finance and boss pages.
- Added server-paginated pending queues for finance review and boss final review, with explicit refresh and fail-closed queue clearing after load failure.
- Displayed immutable Snapshot/Narrative hashes, AI task, Provider/model/Prompt, Claim values and JSON paths, review version, actor, time, reason, and append-only history.
- Mapped every workflow state to explicit text. Only `ACCEPTED` is shown as `已接受文字建议`; finance/boss pending and changes-requested states remain visibly labelled as drafts.
- Sent only expected review version, expected Narrative/Snapshot hashes, command, and reason. The API-mode request never sends role, reviewer ID, actor, or target state.
- Disabled browser action controls when policy is disabled, the role/stage does not match, evidence refresh failed, or the mandatory reason is too short.
- Kept Mock parity deliberately fail-closed: Mock Narratives are stored only for local display/handoff, clearly identify the Mock Provider, and use a disabled review policy rather than simulating persisted acceptance.
- Enabled `finance_then_boss` only in the Playwright test server environment. Application and Demo defaults remain `disabled` unless explicitly configured.
- Added bounded layouts, internal table scrolling, hash wrapping, and a 390 x 844 page-overflow assertion.

## API and UI behavior

- Finance `/finance/reports`: loads the authenticated finance pending queue and can accept, request changes, or reject only a `NEEDS_FINANCE_REVIEW` item.
- Boss `/boss/reports`: loads finance-accepted Narratives awaiting boss review; generated text on the Snapshot panel also exposes refreshable server status.
- A successful finance accept updates the same browser evidence to `NEEDS_BOSS_REVIEW / R1`; a successful boss accept updates it to `ACCEPTED / R2` with both history events.
- A stale/conflicting request is rejected by the CR-034 backend; the queue reloads from the server instead of preserving locally fabricated success.
- No database schema or backend API was changed in this commit.

## Verification evidence

All final commands listed as passed exited `0`:

- Expected red: initial API-mode core workflow `0/1`, missing `草稿 · 待财务复核`; this was fixed without weakening the assertion.
- Frontend production build: passed, `3155` modules transformed.
- Frontend runtime configuration: `4/4` passed.
- API-mode core workflow: `1/1` passed after implementation and again after fail-closed tightening.
- Demo configuration: `6/6` passed.
- `demo:reset` and `demo:verify`: passed against loopback `finance_agent_test`.
- Friday Demo Playwright: `1/1` passed with exactly `3` records and total `13,422.21`; cleanup completed.
- Repository hygiene: passed for `824` tracked or candidate files.
- `git diff --check` and staged hygiene: passed.
- Backend unit/PostgreSQL/migration suites: `NOT_RUN` for this frontend-only commit; the unchanged CR-034 backend was verified immediately before it with `51/473`, report integration `1/1`, and migration `51 / 50 -> 51`.
- Remote push and same-SHA CI: `BLOCKED_EXTERNAL`; no remote success is claimed.

The API browser test proves boss generation, finance logout/login handoff, finance pending read, hash-bound R1 acceptance, boss logout/login handoff, boss pending read, hash-bound R2 acceptance, two persisted history events, unchanged formal record ID/source/status/amount, and no document-level horizontal overflow at 390 px.

## Financial and security impact

- Review controls affect only the interpretation state of AI-generated text. The test re-read the formal record after final acceptance and found the same single confirmed record with the same `4321.09` amount and source work order.
- Claims continue to display deterministic Snapshot values and source paths; the UI does not calculate or replace report numbers.
- Browser role props affect presentation only. Real authorization and stage selection remain server-derived from the authenticated account.
- On load failure, the pending queue is cleared. On generated-evidence refresh failure, actions are removed until a successful server refresh.

## Rollback

- Revert `ad3e28f`. The CR-034 backend remains disabled by default and can continue to store no new decisions.
- No migration rollback is required for this UI commit.

## Remaining limits

- OQ-03 still requires the owner's final product-policy selection; the conservative workflow is explicitly configured only for engineering tests.
- Real-model Narrative quality, real financial wording, owner visual/UAT acceptance, target environment, and production release are not tested.
- Queue scope follows the current global finance/boss role model; no project-membership tenancy claim is made.
- Full multi-spec Playwright and remote CI are deferred to the next consolidated gate, not represented as passed here.

## Next action

Run the consolidated local regression gates, then audit the remaining P2 target-profile/preflight, alerting, image-signing, secret inventory, and backup-evidence framework against existing deployment code before adding any new module.
