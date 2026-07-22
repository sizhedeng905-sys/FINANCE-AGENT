# CR-037 Fail-Closed Target Profile

## Review Status

`LOCAL_ENGINEERING_VERIFIED / TARGET_RESOURCES_BLOCKED_EXTERNAL / REMOTE_PUSH_BLOCKED_EXTERNAL`

Implementation commit: `f3c224b` (`feat: enforce fail-closed staging target profile`).

## Goal

Make `STAGING_DEPLOYMENT_PROFILE=target` a strict, machine-testable contract. A target configuration must not inherit the local CA, local image identity, synthetic seed, reserved domains, loopback-only exposure, broad proxy trust, mutable images, local initialization material, or unresolved metadata.

The command must fail closed with a stable error code when external target inputs are unavailable. It must not manufacture a passing target profile, inspect secret values, or imply that a server has been deployed.

## Failure Reproduction

CR-036 made the topology parameterizable but intentionally accepted an internally consistent target-shaped setting set. Static review showed that `target` could still select:

- `local_ca` and a locally generated initialization record;
- `local_identity` and tag-only service images;
- the synthetic Staging seed;
- `.local`, `.test`, `.invalid`, `example.com`, local environment IDs, or loopback-only bind;
- a trusted-proxy range unrelated to the actual gateway;
- missing/placeholder region, owner, change, secret provider, or certificate issuer metadata.

The initial target attack test run was 11/12: the `.local` case was rejected by CR-036 URL/domain consistency before reaching the expected target-specific error code. The test fixture was corrected to be an internally consistent `.local` topology. The final run reached and asserted `TARGET_TEST_DOMAIN_FORBIDDEN` without weakening the lower-level validator.

## Root Cause

Parameterization and production eligibility are separate concerns. The repository had no explicit target policy object, stable target error taxonomy, or command that could distinguish “valid local demo” from “eligible for read-only target preflight.” Existing image locks protected local releases but did not by themselves prohibit target use of local identity or local initialization artifacts.

## Changes Reviewed

- Added `target-profile.mjs` with stable error codes and a pure fail-closed validator.
- Required target-only non-secret metadata for region, owner ID, change ID, secret provider class, and certificate issuer ID.
- Rejected reserved/local domains and CORS origins, local/test/demo environment IDs, loopback-only bind, all-source proxy trust, and proxy ranges that do not cover the configured gateway.
- Required `provided` TLS files and rejected the generated FINANCE-AGENT local CA or local initialization metadata.
- Required `IMAGE_IDENTITY_POLICY=signed_registry`, a remote registry prefix, registry-bound repository images, and `@sha256` for every rendered service image.
- Added `staging:target:check`, which emits hashed/count-only evidence on success and `blocked_external` plus a stable code with exit code 2 on failure.
- Made `staging:check` invoke the same target contract whenever the target profile is selected.
- Made `staging:init` reject target use before generating target secrets or certificates.
- Extended the Staging runbook with target metadata, status, and non-claim boundaries.

## Schema, API, And UI Behavior

- Database schema/migration: unchanged.
- HTTP API and frontend behavior: unchanged.
- `local_demo`: unchanged and still eligible for local initialization and the Friday Demo.
- `target`: static configuration can proceed only after all contract inputs exist; the command does not deploy, mutate data, contact providers, or create credentials.

## Financial And Security Impact

- No financial record, approval, Snapshot, Claim, Decimal, audit, or ledger logic changed.
- Target synthetic accounts/data are now prohibited at the deployment contract.
- Tag-only or locally identified images cannot be mistaken for a target release candidate.
- Evidence contains SHA-256 identities and counts, not domains, environment IDs, certificate issuer values, secret values, URLs, or certificate keys.
- Allowed secret provider value is a provider class only; the contract does not accept or output a credential.

## Verification Evidence

| Command / check | Result |
| --- | --- |
| Initial `npm run staging:config:test` | EXPECTED_FAIL, 11/12; fixture intercepted by lower-level URL/domain consistency |
| Final `npm run staging:config:test` | PASS, 12/12 tests |
| `npm run staging:check` | PASS, local_demo, 18 services, 19 secret-file presence checks, target `not_applicable` |
| `npm run staging:target:check` against local config | EXPECTED_BLOCKED, exit 2, `TARGET_PROFILE_REQUIRED` |
| `STAGING_DEPLOYMENT_PROFILE=target node .../init-staging.mjs` | EXPECTED_REJECTION before target material generation |
| JavaScript `node --check` for four affected scripts | PASS |
| `npm run demo:test` | PASS, 1/1 Playwright; exactly 3 records and `13422.21` |
| `npm run check:docs` | PASS, 131 Markdown files and 207 local links |
| `npm run check:hygiene` | PASS, 831 tracked/candidate files |
| `git diff --check` and staged hygiene hook | PASS, 7 intended files |

## Not Run Or Blocked

- A successful `staging:target:check` against real target files: `BLOCKED_EXTERNAL(H13)`; the pass path is covered only by synthetic unit input.
- Public DNS, trusted TLS chain, registry digest availability/signatures, firewall/ports, DB/Redis/S3/ClamAV reachability, backup destination, and alert delivery: `BLOCKED_EXTERNAL(H13/H14)`.
- Full application build/backend/PostgreSQL/full Playwright: `NOT_RUN` for this deployment-policy-only commit; CR-036 had passed the frontend build immediately before this step, and this commit reran the complete Friday Demo.
- Full 18-image target release/restore/rollback: `NOT_RUN` and not authorized.
- Owner UAT, independent security review, and production decision: `AWAITING_HUMAN_SIGNOFF(H15/H16)`.
- Remote push/same-SHA CI: `BLOCKED_EXTERNAL`; no new success is claimed.

## Limitations

- `signed_registry` and digest-only references are eligibility requirements, not proof that a signature has been verified; the signature hook is a later independent CR.
- A provided certificate file and non-local subject do not prove public trust, DNS, revocation, expiry at the target, or network reachability; the read-only target preflight owns those checks.
- `docker_secret_files` is an allowed target provider class for a controlled single-host Staging topology. Formal KMS/secret-manager selection remains H13/H14.
- This contract blocks local material but does not rotate, create, or validate secret values; secret inventory/freshness is separate.

## Rollback

Revert implementation commit `f3c224b`. No database rollback is needed. Reverting removes the target eligibility gate and therefore must not be used as a shortcut to deploy a target environment.

## Next Step

Implement CR-038 as a read-only target preflight that runs only after this contract passes and emits anonymized JSON/Markdown for Linux, Docker/Compose, clock, CPU/RAM/disk, DNS, TLS chain/expiry, ports, registry, PostgreSQL, Redis, S3, ClamAV, backup target, and alert configuration. Missing external resources must remain `BLOCKED_EXTERNAL`.
