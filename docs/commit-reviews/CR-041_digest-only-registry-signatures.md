# CR-041 Digest-Only Registry Signatures

## Review Status

`SYNTHETIC_ENGINEERING_VERIFIED / REAL_REGISTRY_AND_TRUST_ROOT_BLOCKED_EXTERNAL / REMOTE_PUSH_BLOCKED_EXTERNAL`

Implementation commit: `7f9bc4e` (`feat: verify digest-only registry signatures`).

## Goal

Add a read-only, fail-closed signature and SLSA provenance verifier for target registry images. The verifier must bind claims to the exact managed repository and SHA-256 digest, must not upload or sign images, and must not report target success when registry credentials, a reviewed public key, Cosign, or target resources are absent.

## Failure Reproduction

The prior `signed_registry` scan invoked `cosign verify` and `verify-attestation`, but then only hashed their stdout. It did not parse the verified claim or prove that the claim and provenance subject matched the image being released. It also wrote `operator_verified_h13` without machine-readable registry-read evidence. There was no standalone target check, stable blocked result, trust-root file validation, or ordinary CI attack suite.

During regression, removal of the legacy Cosign capture helper also removed a function still used by Syft version discovery. The image-integrity test exposed `capture is not defined`. Restoring a dedicated, redacted scanner-version helper fixed that regression. The next full local scan then stopped at the actual environmental prerequisite: the pinned Syft binary is not installed on this workstation.

## Root Cause

The R5 implementation deliberately left registry signing behind H13, but its provisional hook treated successful command execution as sufficient evidence and mixed Cosign output capture with unrelated scanner process handling. The target transition needed a separate verifier with explicit claim parsing, trust-root checks, read-only commands, and blocked-external semantics.

## Changes Reviewed

- Added `staging-registry-signature/1.0` evidence with hashes, digest, counts, policy and authentication mode, but no registry credential, public-key path, repository name, signature body, attestation body or stderr.
- Require every deployed target image to be under the configured managed registry prefix and use `repository@sha256:<64 lowercase hex>`.
- Deduplicate the same immutable image used by multiple services while preserving a non-sensitive use count.
- Require exact signature claim type, repository identity and manifest digest.
- Decode the verified DSSE payload and require an allowed in-toto Statement type, SLSA provenance predicate type, repository subject and SHA-256 digest.
- Require a regular, non-symlink public-key file; reject missing, unreadable, private-key-shaped, malformed and oversized material.
- Limit the adapter to `cosign version`, `cosign verify` and `cosign verify-attestation`; command errors expose stable codes instead of stderr.
- Added a target-profile-only operator CLI that writes ignored, hash-only evidence and uses exit 2 for external prerequisites.
- Replaced the unproven `operator_verified_h13` release value with verifier-produced `registryReadVerification` evidence.
- Added the registry prefix to new image locks, ordinary CI coverage and target runbook instructions.

## Schema, API And UI Behavior

- Database schema/migrations: unchanged.
- Application HTTP API and UI: unchanged.
- Image-lock metadata gains `registryPrefix`; existing `local_identity` behavior remains unchanged.
- New commands:
  - `npm run staging:signature:test` runs the offline synthetic attack suite;
  - `npm run staging:signature:check` requires a complete target profile, exact digest references, approved policy/auth configuration, `.secrets/cosign.pub` and Cosign.
- The supply-chain scan reuses the same verifier only when the lock policy is `signed_registry`.

## Financial And Security Impact

- No BusinessRecord, RecordValue, approval, Decimal, audit, ledger, outbox, Snapshot or Claim behavior changed.
- The tool has no sign, copy, push, upload, delete, registry-write, SQL or application-write operation.
- Public-key and provider outputs are bounded before parsing; malformed JSON, absent identity, wrong digest, wrong repository, wrong statement/predicate type and wrong provenance subject fail closed.
- Missing target resources remain `blocked_external`; a command exit code cannot silently promote local evidence to target acceptance.
- A verified signature proves only that the configured key signed the exact digest. It does not prove that key custody, signer authorization, registry policy, vulnerability posture or production release was approved.

## Verification Evidence

| Command / check | Result |
| --- | --- |
| `npm run staging:signature:test` | PASS, 9/9; digest/repository/type binding, SLSA subject, NDJSON, target input, trust-root file, command allowlist and redaction attacks |
| `npm run staging:config:test` | PASS, 12/12 |
| `npm run staging:signature:check` under `local_demo` | EXPECTED_BLOCKED, exit 2, `TARGET_PROFILE_REQUIRED`; no registry call |
| First `npm run staging:image-integrity:test` | FAIL, exposed removed shared `capture` helper; fixed before commit |
| Second `npm run staging:image-integrity:test` | BLOCKED_EXTERNAL after image tests reached local scan; pinned Syft binary absent |
| `node deploy/staging/scripts/test-image-integrity.mjs --defer-scan` | PASS, 17/17 local image identity, drift, tamper and cleanup cases; scanner explicitly deferred |
| `npm run staging:check` | PASS; local_demo, 18 services, 20 secret files, `local_identity` unchanged |
| `npm run demo:config:test` | PASS, 6/6 |
| `npm run check:docs` | PASS, 136 Markdown files and 213 local links before this review document |
| `npm run check:hygiene` | PASS, 848 tracked/candidate files |
| `git diff --check` and staged hygiene hook | PASS, 8 intended implementation files |

## Not Run Or Blocked

- Real managed registry authentication/read: `BLOCKED_EXTERNAL(H13)`.
- Reviewed Cosign public key, signer identity/custody and real signature/provenance: `BLOCKED_EXTERNAL(H13/H15)`.
- Full Syft/Grype scan on this workstation: `BLOCKED_EXTERNAL`; `syft` is absent. CI installs the pinned tool, but same-SHA remote CI has not run yet.
- No registry image was uploaded, copied, signed, deleted or modified.
- Full frontend/backend build, PostgreSQL integration and multi-spec Playwright: `NOT_RUN` for this deployment-only change; the Friday Demo configuration contract was rerun.
- Target release, rollback, production authorization and UAT remain `BLOCKED_EXTERNAL / AWAITING_HUMAN_SIGNOFF`.

## Limitations

- Key-based verification does not implement keyless Fulcio/Rekor identity policy or KMS signing; choosing that production trust model remains H13/H15 work.
- Registry authorization mode is declared and recorded, but credential scope and server-side write denial require a real target and independent evidence.
- Existing historical locks without `metadata.registryPrefix` cannot use the new signed-registry path and must be regenerated from reviewed target configuration.
- Allowed in-toto/SLSA versions are explicit. A future provenance format requires a reviewed code change rather than permissive fallback.

## References

- [Sigstore: Verify signatures](https://docs.sigstore.dev/cosign/verifying/verify/)
- [Sigstore: Verify attestations](https://docs.sigstore.dev/cosign/verifying/attestation/)

## Rollback

Revert implementation commit `7f9bc4e`. No database or business-data rollback is required. A target that had adopted the new signed-registry policy must not fall back to `operator_verified_h13`; keep release blocked until an equivalent digest- and subject-binding verifier is reviewed.

## Next Step

Implement CR042: a value-free secret inventory, freshness policy, rotation order, rollback runbook and synthetic rotation tests. No real secret value may enter Git or evidence.
