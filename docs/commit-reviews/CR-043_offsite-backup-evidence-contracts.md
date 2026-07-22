# CR-043 Offsite Backup Evidence Contracts

## Review Status

`SYNTHETIC_ENGINEERING_VERIFIED / REAL_OFFSITE_RESTORE_BLOCKED_EXTERNAL / H14_TARGETS_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL`

Implementation commit: `fbbb426` (`feat: add offsite backup evidence contracts`).

## Goal

Extend the existing strong-hash backup/restore chain with a target-only offsite declaration, encryption/immutability contract, exact replica evidence and RPO/RTO timing schema. Do not add an uploader, touch a remote object, execute a live restore or claim that target disaster recovery passed.

## Failure Reproduction

R4/R8.6 already generated `backup-manifest/1.0`, streamed object SHA-256, checked database/object references, restored into isolated resources and measured local synthetic RPO/RTO. The target preflight only had a destination ID and health URL. There was no checked distinction between local private/versioned MinIO and a separate failure domain, no hash-only KMS/immutability declaration, and no schema binding a timing claim to the exact verified offsite replica.

Three test findings were corrected before commit:

- numeric RPO input was initially parsed through an identifier regex, producing an imprecise missing/invalid code;
- a supposed time-order fault used equal start/end timestamps, which is a valid zero-duration boundary;
- after recovery-point binding was added, the overrun fixture placed failure detection before replica completion and was correctly rejected.

## Root Cause

The current backup container writes correlated logical/object evidence to the same Staging MinIO/backup volume. That is useful for engineering recovery tests but cannot prove independent-region durability, provider encryption, object lock or business RPO/RTO. Those external facts need an explicit, hash-bound evidence contract rather than inferred success from a health endpoint.

## Changes Reviewed

- Added `STAGING_OFFSITE_BACKUP_MODE=disabled` for `local_demo`; local configuration rejects an enabled offsite mode.
- Target syntax requires `contract_only`, separate target/offsite regions, a distinct failure-domain ID, provider/replication class, versioning, approved encryption and immutability modes, KMS key ID, retention policy ID and declared RPO/RTO.
- Output hashes destination, region, failure-domain, KMS and retention identifiers; it does not retain their raw values.
- Marks a syntactically complete target contract `declared_unverified` and `pending_h13_h14_h15`.
- Added `staging-offsite-replication-evidence/1.0` requiring exact source/destination manifest hash, object count, bytes, encryption/KMS declaration, versioning, immutability and ordered timestamps.
- Freezes `sourceRecoverablePointAt` in replica evidence so a later timing request cannot replace it.
- Added `staging-recovery-timing-evidence/1.0`; RPO derives from the verified replica recovery point and RTO ends only after restore verification.
- Requires replica completion no later than failure detection, and only accepts `synthetic` or `target_isolated` scope.
- Added target declaration instructions and explicit local/target blocked semantics to the Staging Runbook.
- Integrated the declaration into `staging:check` and ordinary CI tests.

## Schema, API And UI Behavior

- Database schema/migrations: unchanged.
- Application HTTP API and UI: unchanged.
- Existing `backup-manifest/1.0`, restore scripts, MinIO buckets and backup volume: unchanged.
- New commands:
  - `npm run staging:offsite-backup:test` runs synthetic contract/replica/timing attacks;
  - `npm run staging:offsite-backup:contract` records local disabled evidence or returns target exit 2 until real evidence exists.
- `staging:check` now records the offsite contract status/hash/acceptance boundary.

## Financial And Security Impact

- No BusinessRecord, RecordValue, approval, Decimal, audit, ledger, outbox, Snapshot or Claim behavior changed.
- No external URL, credential, KMS key material, bucket content or object is read or written.
- A destination health response is not treated as replica or restore proof.
- Manifest, count or byte mismatch; partial copy; KMS/encryption mismatch; missing versioning; immutability mismatch; and invalid chronology all fail closed.
- RPO/RTO values are deterministic integer seconds and remain `pending_h14_h15`, even when a synthetic measurement is below a declared target.

## Verification Evidence

| Command / check | Result |
| --- | --- |
| Initial offsite test run | FAIL, 6/8; corrected numeric validation and zero-duration fault fixture |
| Evidence-binding regression run | FAIL, 7/8; rejected failure timestamp before replica completion; fixture corrected |
| Final `npm run staging:offsite-backup:test` | PASS, 8/8; topology, declaration redaction, partial/mismatch faults, bound timing, overrun and scope attacks |
| `npm run staging:offsite-backup:contract` | PASS for local-only behavior: `disabled_local_demo`; no network |
| `npm run staging:backup-integrity:test` | PASS, 9/9 existing R4 strong-hash, manifest and database-reference cases |
| `npm run staging:config:test` | PASS, 12/12 |
| `npm run staging:check` | PASS; local_demo explicitly records offsite backup disabled/not applicable |
| `npm run demo:config:test` | PASS, 6/6 |
| JavaScript `node --check` and `git diff --check` | PASS |
| `npm run check:docs` | PASS, 138 Markdown files and 214 local links before this review document |
| `npm run check:hygiene` | PASS, 857 tracked/candidate files |
| Staged hygiene hook | PASS, 8 intended implementation files |

## Not Run Or Blocked

- Real offsite provider, independent account/region/failure domain and destination health: `BLOCKED_EXTERNAL(H13)`.
- Provider-side SSE-KMS/client envelope proof, key custody, versioning, retention and Object Lock evidence: `BLOCKED_EXTERNAL(H13/H14)`.
- Approved RPO/RTO targets and real target-isolated restore timing: `PENDING_HUMAN_DECISION / BLOCKED_EXTERNAL(H14/H15)`.
- Live restore is deliberately unsupported by the new schema and was not executed.
- Full frontend/backend build, PostgreSQL application integration and multi-spec Playwright: `NOT_RUN` for this deployment-evidence-only change; Demo configuration and existing backup integrity were rerun.
- Target release, production authorization and UAT remain `BLOCKED_EXTERNAL / AWAITING_HUMAN_SIGNOFF`.

## Limitations

- `contract_only` validates a declaration; it does not query provider encryption, retention or immutability APIs.
- No replication agent/provider API is implemented. Future real evidence must be produced by a separately reviewed, least-privilege path.
- Equal object count/bytes plus manifest hash is accepted only because the source manifest already contains per-object strong hashes; the current module does not replace R4 verification.
- A target-isolated measurement still requires independent owner/security signoff before it becomes an accepted business RPO/RTO result.

## Rollback

Revert implementation commit `fbbb426`. No database, backup object or business-data rollback is required. Reverting removes only the declaration/evidence framework and must not be interpreted as allowing local MinIO evidence to stand in for offsite disaster recovery.

## Next Step

Implement CR044 by refreshing dependency and image scan evidence, applying only safely verifiable upgrades, preserving the Critical gate and refusing unsupported allowlists.
