# CR-042 Value-Free Secret Lifecycle

## Review Status

`SYNTHETIC_ENGINEERING_VERIFIED / REAL_PROVIDER_ROTATION_BLOCKED_EXTERNAL / H14_POLICY_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL`

Implementation commit: `9d31cf8` (`feat: add value-free secret lifecycle gates`).

## Goal

Create a value-free inventory, freshness gate, ordered rotation model, rollback boundary and synthetic rotation suite for every Staging file-secret. The framework must not read, generate, replace, revoke, hash or emit a real secret value and must not claim that provider rotation passed.

## Failure Reproduction

The existing configuration gate checked that 20 fixed files existed and exceeded a minimum length. It did not have a versioned policy mapping each file to its consumers, did not detect stale/future/symlinked/insecure metadata, and did not model coupled values such as a database password plus its derived connection URL. The runbook had no machine-testable ordering, idempotency or distinction between rollback before revocation and forward repair after revocation.

The first synthetic rollback test reused the same idempotency key for verification before revocation and verification after a forward fix. The state machine correctly rejected it as `SECRET_ROTATION_IDEMPOTENCY_CONFLICT`; the fixture was corrected to use a new command identity.

## Root Cause

Secrets were intentionally local/generated or externally provisioned pending H13/H14. That safe default prevented values entering Git, but lifecycle metadata and coordinated rotation behavior had not been expressed as a checked contract. Independent file replacement would be unsafe for provider credentials and their derived URLs.

## Changes Reviewed

- Added `staging-secret-policy/1.0` with 20 names, categories, exact Compose consumers, 13 rotation sets, consumer order and impact codes; it contains no values.
- Marked the age policy `engineering_default_pending_h14`: 90 days by default and 30 days for the local synthetic seed, with explicit warning windows.
- Added strict policy/Compose reconciliation so added, removed or rewired file-secrets fail configuration validation until the reviewed policy changes with them.
- Added metadata-only inventory using fixed-path `lstat`; no file content is opened.
- Reject missing, undersized, oversized, future-dated, symlinked and non-file entries. Linux additionally rejects group/world permissions and hard links.
- Added stable `fresh`, `due_soon`, `stale`, `missing` and `invalid` counts plus policy/inventory hashes without paths, sizes, mtimes, modes or content hashes.
- Integrated stale/invalid inventory into `staging:check`, which is already the first release gate.
- Added an optimistic, idempotent command state machine from precheck through staging, provider activation, consumer reload, verification and old-version revocation.
- Made `revoke_old` the rollback boundary: pre-revocation failures may roll back; post-revocation failures require forward fix.
- Added runbook constraints for coupled password/URL groups, JWT session invalidation, target seed disabling and external-provider execution.
- Added ordinary CI coverage and operator inventory commands.

## Schema, API And UI Behavior

- Database schema/migrations: unchanged.
- Application HTTP API and UI: unchanged.
- New repository policy: `deploy/staging/secret-policy.json`.
- New evidence schemas: `staging-secret-inventory/1.0` and `staging-secret-rotation/1.0`.
- New commands:
  - `npm run staging:secret:test` runs synthetic metadata and rotation tests;
  - `npm run staging:secret:inventory` writes ignored, value-free inventory evidence.
- `npm run staging:check` now records freshness status/counts and policy/inventory hashes.

## Financial And Security Impact

- No BusinessRecord, RecordValue, approval, Decimal, audit, ledger, outbox, Snapshot or Claim behavior changed.
- The inventory code has no `readFile` access to `.secrets`; it receives only `lstat` metadata.
- No secret content hash is retained because low-entropy values could otherwise be tested offline.
- Generation and idempotency identifiers are hashed in rotation evidence; commands accept fixed reason codes rather than free-text sensitive details.
- The framework contains no provider mutation or service restart executor. Real changes remain an explicitly authorized operational procedure outside Git.
- File mtime is labeled as an engineering freshness signal, not proof of provider version creation or cryptographic rotation.

## Verification Evidence

| Command / check | Result |
| --- | --- |
| Initial `npm run staging:secret:test` | FAIL, 8/9; fixture reused an idempotency key and was corrected |
| Final `npm run staging:secret:test` | PASS, 9/9; policy/Compose, redaction, age/file attacks, Windows boundary, optimistic/idempotent ordering, rollback and forward fix |
| `npm run staging:secret:inventory` | PASS; 20/20 fresh local file metadata, zero values/paths in output |
| `npm run staging:check` | PASS; local_demo, 18 services, 20 secrets, policy and inventory hashes recorded |
| `npm run staging:config:test` | PASS, 12/12 |
| `npm run demo:config:test` | PASS, 6/6 |
| JavaScript `node --check` | PASS for lifecycle, inventory CLI and modified config verifier |
| `npm run check:docs` | PASS, 137 Markdown files and 214 local links before this review document |
| `npm run check:hygiene` | PASS, 853 tracked/candidate files |
| `git diff --check` and staged hygiene hook | PASS, 8 intended implementation files |

## Not Run Or Blocked

- Real Vault/KMS/cloud Secret Manager or Docker secret-provider rotation: `BLOCKED_EXTERNAL(H13/H14)`.
- Formal maximum age, emergency rotation and retention policy: `PENDING_HUMAN_DECISION(H14)`; current ages are an engineering default only.
- Real credential dual-version activation, service restart, old-version revocation and rollback: `BLOCKED_EXTERNAL(H13/H14/H15)`.
- No real secret file content was read or modified by the new inventory/test code.
- Full frontend/backend build, PostgreSQL integration and multi-spec Playwright: `NOT_RUN` for this deployment-metadata change; Demo configuration was rerun.
- Target release, production authorization and UAT remain `BLOCKED_EXTERNAL / AWAITING_HUMAN_SIGNOFF`.

## Limitations

- A touched/remounted file can have a fresh mtime without a new provider version. H13 must supply provider-native version evidence before production acceptance.
- HS256 currently uses one active JWT secret, so rotation invalidates active sessions; dual-key overlap is not invented in this change.
- Some providers support dual credentials while others require a maintenance window. The repository models the boundary but does not infer provider-specific mutation commands.
- The local synthetic seed remains represented because Compose mounts it, even though target policy must keep synthetic seeding disabled.

## Rollback

Revert implementation commit `9d31cf8`. No database or business-data rollback is required. Reverting removes the new freshness gate; do not interpret that as approval to rotate coupled files independently or to release with stale target credentials.

## Next Step

Implement CR043: an offsite-backup configuration contract, encryption declaration, RPO/RTO timing evidence and deterministic failure-injection tests without claiming that a real target restore passed.
