# CR-036 Parameterized Staging Topology

## Review Status

`LOCAL_ENGINEERING_VERIFIED / TARGET_ENVIRONMENT_BLOCKED_EXTERNAL / REMOTE_PUSH_BLOCKED_EXTERNAL`

Implementation commit: `c98678e` (`feat: parameterize staging deployment topology`).

## Goal

Remove the fixed local-demo domain and repository assumptions from the existing 18-service Staging path while preserving the Friday Demo exactly. Domain, CORS, object endpoint, proxy CIDR, bind/probe addresses, ports, certificate mode, environment identity, registry prefix, and synthetic seed mode must be one validated configuration set.

This change is a prerequisite for a target profile. It does not claim that a target Linux host, public DNS, trusted TLS, registry, secrets, or recovery environment exists.

## Failure Reproduction

Before the change, a repository search showed fixed values in the runtime path:

- `compose.yaml` fixed the application/object domains, CORS, S3 endpoint, gateway bind address, proxy address, Grafana URL, and backup environment identity;
- `gateway/nginx.conf`, both smoke scripts, and local certificate generation fixed `*.finance-agent.local`;
- `release.mjs` always tagged repository images below the local `finance-agent` prefix;
- no shared validator proved that a changed domain, URL, CORS origin, and published port still referred to the same endpoint.

The existing default deployment rendered successfully, but a target-shaped configuration could not be represented consistently without editing tracked files. That is an operational and reviewability defect, not evidence that a real target environment was available.

During verification, the first ad-hoc PowerShell assertion array returned a false result despite all printed fields matching. Re-running the same rendered Compose output with nine named assertions proved all nine values true; this was a test-harness expression issue, not a product bypass. The named evidence is the result used below.

## Root Cause

The original B8-09 Compose stack was intentionally built around one isolated local host. Configuration ownership was split between Compose defaults, Nginx, smoke scripts, certificate generation, and the release script. Environment variables existed for only a subset of the public boundary, and no common parser enforced cross-field consistency.

## Changes Reviewed

- Added `deployment-environment.mjs` as the single non-secret parser and validator for local/target-shaped topology values.
- Added local-demo defaults matching the previous URLs, ports, addresses, environment ID, image prefix, certificate behavior, and synthetic seed behavior.
- Parameterized Compose CORS, trusted proxies, S3/MinIO/Grafana URLs, published addresses and ports, network aliases, gateway IP, environment ID, and seed execution.
- Made Nginx virtual-host matching independent of hard-coded names; TLS SAN validation remains authoritative.
- Made certificate generation use configured domains; `provided` mode never creates or overwrites TLS material and fails when required files are absent.
- Made Node and browser smoke tests consume the same validated endpoint and SNI values.
- Made release image tags use the validated OCI registry prefix.
- Extended `staging:check` to verify certificate SANs and the rendered topology against the same settings.
- Updated the Staging runbook without declaring target acceptance.

## Schema, API, And UI Behavior

- Database schema/migration: unchanged.
- HTTP API contract: unchanged.
- Frontend UI and routes: unchanged.
- Default local Demo URL and data: unchanged.
- Target deployment remains disabled by missing external resources and by the follow-up fail-closed target contract.

## Financial And Security Impact

- No BusinessRecord, Snapshot, Claim, approval, Decimal calculation, or ledger behavior changed.
- A disabled synthetic-seed mode now skips the seed command deterministically; the default remains enabled only for the local demo profile.
- Certificate SANs, CORS, proxy trust, object endpoint, and exposed ports are now checked as one configuration boundary before release.
- Registry input is restricted to a lowercase OCI repository prefix without scheme, tag, or digest.
- No secret values, local `.env`, TLS private keys, model files, real data, or evidence artifacts were staged.

## Verification Evidence

| Command / check | Result |
| --- | --- |
| `npm run staging:config:test` | PASS, 7/7 Node tests |
| JavaScript `node --check` for six changed staging scripts | PASS |
| `npm run staging:check` | PASS, 18 services, 19 required secrets, parameterized topology and certificate SAN checks |
| Target-shaped `docker compose ... config --format json` named assertions | PASS, 9/9 non-sensitive topology assertions |
| `npm run demo:config:test` | PASS, 6/6 tests |
| `npm run demo:test` | PASS, 1/1 Playwright; exactly 3 records and `13422.21` |
| `npm run build` | PASS, 3,155 Vite modules |
| `npm run check:docs` | PASS, 130 Markdown files and 206 local links |
| `npm run check:hygiene` | PASS, 827 tracked/candidate files |
| `git diff --check` and staged hygiene hook | PASS, 12 intended files |

## Not Run Or Blocked

- Full backend unit/PostgreSQL suites and full multi-spec Playwright: `NOT_RUN`; this change does not alter application or database code, and the Friday Demo plus deployment-specific gates were run.
- Full 18-image build/release/restore/rollback: `NOT_RUN`; no application image or migration changed, and a full release would not prove the missing target environment.
- Target Linux, DNS, trusted certificate chain, registry push/signature, external alert delivery, real secrets/KMS, offsite backup, and measured target RPO/RTO: `BLOCKED_EXTERNAL(H13/H14)`.
- Owner UAT and production authorization: `AWAITING_HUMAN_SIGNOFF(H15/H16)`.
- Remote push and same-SHA GitHub CI: `BLOCKED_EXTERNAL` at document creation because the branch already had substantial unpushed history after prior network failures; no new push result is claimed here.

## Limitations

- `resolveDeploymentEnvironment` accepts a target-shaped setting set, but CR-036 alone does not yet reject every local-only value under `target`; CR-037 owns that fail-closed policy.
- `provided` validates local files and SANs through `staging:check`; it does not prove public trust, DNS routing, OCSP, firewall policy, or external reachability.
- Parameterized registry tags are not signatures. Digest-only and signature hooks remain a separate gate.
- Existing target release, alerting, secret rotation, and offsite recovery claims remain blocked.

## Rollback

Revert implementation commit `c98678e`. This restores the prior local-only Compose settings and smoke behavior. No database rollback or data mutation is required.

## Next Step

Implement CR-037 as an independent target-profile contract that rejects local CA, `local_identity`, synthetic seed, default test domains, local environment IDs, loopback-only binding, incomplete image identity, and missing target metadata before any target preflight or release action.
