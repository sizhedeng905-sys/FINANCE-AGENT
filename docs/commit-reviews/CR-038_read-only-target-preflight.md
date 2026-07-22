# CR-038 Read-Only Target Preflight

## Review Status

`SYNTHETIC_ENGINEERING_VERIFIED / REAL_TARGET_BLOCKED_EXTERNAL / REMOTE_PUSH_BLOCKED_EXTERNAL`

Implementation commit: `4a6ad4a` (`feat: add read-only staging target preflight`).

## Goal

Provide a target-environment preflight that can inspect prerequisites and dependency health without deploying, migrating, uploading, writing business data, sending an alert, running a backup, or restoring anything. It must run only after CR-037 target eligibility succeeds and emit anonymized JSON plus Markdown evidence.

Required coverage is Linux, Docker/Compose, clock synchronization, CPU/RAM/disk, DNS, TLS chain/expiry, application/object ports, registry v2, PostgreSQL TLS, authenticated Redis ping, S3 health, ClamAV ping, backup target health, and alert-route health.

## Failure Reproduction

The existing self-hosted workflow had a Bash host-resource block and the local release had smoke/restore checks, but there was no reusable target preflight contract:

- target DNS, TLS, registry, private dependencies, backup destination, and alert route were not one machine-readable result;
- evidence could not distinguish missing external input from a configured target that failed a probe;
- no anonymized Markdown/JSON schema existed;
- the release workflow itself performs builds, Compose changes, migrations, backups, and restore drills, so it is not a read-only preflight;
- there were no exact resource/TLS boundary tests or assertions that URLs, credentials, errors, hostnames, and endpoint values stay out of evidence.

## Root Cause

Host prerequisites, runtime smoke, and recovery evidence had evolved in separate scripts. They served local release acceptance but were not an eligibility layer for an externally supplied target. Reusing the release script would violate the required no-mutation preflight boundary.

## Changes Reviewed

- Added a shared target-context loader used by target profile and preflight commands.
- Added `staging-target-preflight/1.0` with per-check `passed`, `failed`, and `blocked_external` status plus stable codes.
- Added a pure 17-check orchestrator and anonymized Markdown renderer.
- Added a system adapter limited to read-only operations: version reads, `timedatectl`, filesystem stats, DNS, TCP/TLS, registry `GET /v2/`, PostgreSQL SSLRequest/TLS handshake, Redis `AUTH` + `PING`, HTTPS health reads, and ClamAV `PING`.
- Added conservative defaults: 4 CPU, 12 GiB RAM, 48 GiB free disk, 14 TLS days, and 5-second probes; invalid overrides fail closed.
- Required explicit PostgreSQL, Redis, S3, ClamAV, backup, and alert target metadata.
- Added `staging:preflight` and `staging:preflight:test`; the synthetic suite now runs in ordinary CI.
- Kept local execution behind CR-037: it emits `blocked_external` and exits 2 before any target network probe.
- Documented the exact strength and limitations of each probe.

## Schema, API, And UI Behavior

- Database schema/migration: unchanged.
- Application HTTP API and UI: unchanged.
- New evidence is written only below ignored `deploy/staging/.evidence/`.
- JSON includes status, timestamps, hashes, counts, numeric capacity/TLS evidence, stable codes, and durations; it excludes raw domains, IPs, URLs, registry paths, environment IDs, secret values, certificate subjects, and probe errors.
- Markdown intentionally lists only check ID/status/code and scope disclaimer.

## Financial And Security Impact

- No BusinessRecord, approval, Snapshot, Claim, Decimal, audit, ledger, or outbox behavior changed.
- PostgreSQL preflight performs only the protocol SSL negotiation; it does not authenticate or issue SQL.
- Redis authenticates with the fixed private secret file and sends only `PING`; the credential is never returned or logged.
- Health URLs reject embedded credentials, query strings, fragments, and non-HTTPS schemes.
- S3/backup/alert health success proves endpoint response only. It is not evidence of bucket authorization, encryption, alert delivery, backup integrity, restore, RPO, or RTO.
- Unexpected adapter errors are replaced by `TARGET_PROBE_FAILED`; raw messages cannot enter evidence.

## Verification Evidence

| Command / check | Result |
| --- | --- |
| `npm run staging:preflight:test` | PASS, 6/6 tests; 17-check success, zero-probe missing config, exact thresholds, under-threshold/TLS expiry, malicious URL/error redaction, Markdown/blocking |
| `npm run staging:config:test` | PASS, 12/12 target/config tests |
| `npm run staging:check` | PASS, local_demo, 18 services, 19 secret-file presence checks |
| `npm run staging:preflight` against local config | EXPECTED_BLOCKED, exit 2; anonymized evidence paths reported; no target probes executed |
| Refactored `npm run staging:target:check` against local config | EXPECTED_BLOCKED, exit 2, `TARGET_PROFILE_REQUIRED` |
| JavaScript `node --check` for five affected scripts | PASS |
| `npm run demo:test` | PASS, 1/1 Playwright; exactly 3 records and `13422.21` |
| `npm run check:docs` | PASS, 132 Markdown files and 208 local links |
| `npm run check:hygiene` | PASS, 837 tracked/candidate files |
| `git diff --check` and staged hygiene hook | PASS, 9 intended files |

## Not Run Or Blocked

- System adapter against a real Linux target: `BLOCKED_EXTERNAL(H13/H14)`. All successful dependency results are synthetic; no real DNS, TLS, registry, DB, Redis, S3, ClamAV, backup, or alert availability is claimed.
- Registry authentication/signature, S3 authenticated bucket operations, alert delivery/recovery, and backup/restore: `NOT_IN_SCOPE` for this read-only health layer and handled by later independent gates.
- Full frontend/backend build, backend/PostgreSQL, and multi-spec Playwright: `NOT_RUN` for this deployment-script-only commit; the complete Friday Demo was rerun.
- New ordinary CI step and same-SHA GitHub status: `REMOTE_PUSH_BLOCKED_EXTERNAL`; the workflow edit has not run remotely.
- Target release, restore, rollback, RPO/RTO, owner UAT, independent review, and production authorization: `BLOCKED_EXTERNAL / AWAITING_HUMAN_SIGNOFF(H13-H16)`.

## Limitations

- NTP status relies on `timedatectl` on the target Linux host. Unsupported hosts fail rather than silently passing.
- PostgreSQL TLS negotiation proves transport availability only, not role permissions or query correctness.
- Registry `200/401` proves a TLS-protected v2 endpoint, not image presence, authorization, digest existence, or signature validity.
- The provided CA is trusted for probes by design; public trust/revocation and formal certificate policy still require H13/security review.
- Local generated evidence remains machine-local and ignored; no retention policy is inferred before H14.

## Rollback

Revert implementation commit `4a6ad4a`. No data rollback is needed. Reverting removes only the preflight and its CI unit gate; it does not alter the CR-037 target eligibility contract.

## Next Step

Implement CR-039 as a provider-neutral alert receiver framework using webhook configuration plus file-based secret, with synthetic firing and recovery delivery tests. A real receiver URL remains absent and must be reported as `BLOCKED_EXTERNAL`.
