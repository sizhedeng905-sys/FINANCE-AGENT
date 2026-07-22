# CR-040 File-Secret Alert Delivery

## Review Status

`SYNTHETIC_ENGINEERING_VERIFIED / REAL_RECEIVER_BLOCKED_EXTERNAL / REMOTE_CI_PENDING`

Implementation commit: `9ff01d5` (`feat: add file-secret alert delivery framework`).

## Goal

Add a provider-neutral Alertmanager webhook route and a synthetic firing/recovery delivery tool without committing a real URL, contacting an external receiver during automated tests, weakening the local Friday Demo, or claiming that target alert operations passed.

## Failure Reproduction

The existing Alertmanager topology had a deliberately empty receiver. Target preflight could check an alert health URL, but the repository did not provide:

- a target-only `url_file` receiver configuration;
- a fixed file-secret mount for the receiver URL;
- a bounded and redacted firing/resolved synthetic delivery contract;
- explicit operator authorization before external delivery;
- partial evidence when firing succeeds but recovery fails;
- tests for retries, malformed transport responses, unsafe URLs and secret leakage;
- a fail-closed distinction between the local empty receiver and target webhook configuration.

## Root Cause

Monitoring had been built conservatively before H13 supplied a receiver. That avoided accidental outbound alerts, but there was no controlled transition path from the safe local receiver to a target route and no receiver-level delivery evidence schema.

## Changes Reviewed

- Added target-only `monitoring/alertmanager-webhook.yml` using Alertmanager native `url_file` and `send_resolved`.
- Added the `alert_webhook_url` Compose secret and mounted it only into Alertmanager.
- Kept `local_demo` on the original empty receiver and created only a non-URL disabled placeholder for local initialization.
- Required target profile to select the webhook configuration; rendered config verification rejects either profile using the other's file.
- Added `staging-alert-synthetic/1.0` firing/resolved payloads with stable hashed route identity and no business data.
- Added HTTPS URL validation, credential/fragment rejection, redirect refusal, 500-30,000 ms timeout bounds, one-to-five retry bounds and retries only for 429/500/502/503/504.
- Added safe partial evidence when resolved delivery fails after firing succeeds.
- Added double authorization: exact one-shot process environment value plus `--confirm-target-alert-delivery` argument.
- Required the complete CR037 target context before reading the receiver secret or sending.
- Added ignored JSON evidence containing only status, phase, attempts, HTTP status and hashes.
- Added ordinary CI coverage for the synthetic unit suite and updated the Staging Runbook.

## Schema, API And UI Behavior

- Database schema/migrations: unchanged.
- Application HTTP API and UI: unchanged.
- New operator commands:
  - `npm run staging:alert:test` performs loopback-only synthetic tests;
  - `npm run staging:alert:synthetic -- --confirm-target-alert-delivery` is blocked unless the one-shot approval variable and a complete target profile are present.
- Local Compose remains 18 services and keeps the non-outbound receiver.
- Target Compose must set `STAGING_ALERTMANAGER_CONFIG_FILE=./monitoring/alertmanager-webhook.yml`.

## Financial And Security Impact

- No BusinessRecord, RecordValue, approval, Decimal, audit, ledger, outbox, Snapshot or Claim behavior changed.
- The URL is read from an ignored file only; it is absent from Compose environment, Git, CLI arguments and evidence.
- Errors use stable codes and do not include URL, provider body or low-level exception text.
- The sender uses no SQL, application API, model, object storage or business data.
- Automated tests use only a temporary `127.0.0.1` receiver and explicitly opt into HTTP loopback; target URLs require HTTPS.
- `local_demo` cannot switch to the real webhook config through the verified deployment path.

## Verification Evidence

| Command / check | Result |
| --- | --- |
| `npm run staging:alert:test` | PASS, 9/9; dual authorization, firing/recovery, retries, unsafe URL, redaction, partial recovery failure, invalid limits/transport and cleanup exception |
| `npm run staging:config:test` | PASS, 12/12; target must use the file-secret config |
| `npm run staging:init` | PASS; added exactly one missing ignored local placeholder secret without overwriting existing values |
| `npm run staging:check` | PASS; local_demo, 18 services, 20 secret files, fixed empty receiver mount |
| Local config with target webhook override | EXPECTED_FAIL; `local_demo must use its fixed Alertmanager configuration` |
| `amtool check-config` in the pinned local Alertmanager image | PASS for both empty local and target `url_file` configurations |
| Synthetic command without approval | EXPECTED_BLOCKED, exit 2, `ALERT_SYNTHETIC_APPROVAL_REQUIRED`, zero deliveries |
| Synthetic command with approval but local profile | EXPECTED_BLOCKED, exit 2, `TARGET_PROFILE_REQUIRED`, zero deliveries |
| JavaScript `node --check` for sender, CLI and tests | PASS |
| `npm run demo:config:test` | PASS, 6/6 |
| `npm run demo:reset` and `npm run demo:verify` | PASS, isolated `finance_agent_test`; 51 migrations current; external providers disabled |
| `npm run demo:test` | PASS, 1/1 Playwright; exactly 3 records and `13422.21` |
| `npm run check:docs` | PASS, 135 Markdown files and 212 local links before this review document |
| `npm run check:hygiene` | PASS, 844 tracked/candidate files |
| `git diff --check` and staged hygiene hook | PASS, 13 intended implementation files |

## Not Run Or Blocked

- No real webhook URL was supplied, read, logged or contacted: `BLOCKED_EXTERNAL(H13/H14)`.
- Prometheus rule to Alertmanager to human-channel end-to-end firing, grouping, inhibition, escalation, receipt and closure: `BLOCKED_EXTERNAL(H13/H14/H15)`.
- The synthetic operator command validates the receiver contract directly; it does not claim the complete Prometheus/Alertmanager chain passed.
- Full frontend/backend build, PostgreSQL integration and multi-spec Playwright were `NOT_RUN` for this deployment-only change; the complete Friday Demo was rerun.
- Same-SHA GitHub Build/CodeQL/integration for `9ff01d5`: `REMOTE_CI_PENDING`.
- Target release, production alerting, UAT and production authorization remain `BLOCKED_EXTERNAL / AWAITING_HUMAN_SIGNOFF`.

## Limitations

- Provider-specific payload signing, Teams/Slack/PagerDuty behavior, rate limits and escalation are not inferred by the generic webhook contract.
- A 2xx receiver response proves HTTP acceptance only, not that a human saw or acted on the notification.
- Hashed endpoint identity is useful for comparing evidence but does not replace a controlled receiver inventory.
- A firing success followed by recovery failure requires operator action; the tool records the partial result but cannot close an external incident by itself.

## Rollback

Revert implementation commit `9ff01d5`. The local empty receiver remains available in the parent commit. No database or business data rollback is needed. If a target had already mounted the webhook configuration, restore `STAGING_ALERTMANAGER_CONFIG_FILE` under a reviewed change and verify Alertmanager before restarting it.

## Next Step

Implement CR041 as a digest-only registry and signature-verification hook. Missing registry, signature identity or trust material must return `BLOCKED_EXTERNAL`; no image may be uploaded and no synthetic signature may be reported as a real pass.
