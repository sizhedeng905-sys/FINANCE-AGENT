#!/bin/bash
set -Eeuo pipefail

source /opt/staging/integrity-lib.sh
require_integrity_tools

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

entry() {
  local key="$1" size="$2" sha="$3"
  jq -cnS --arg key "$key" --arg sha "$sha" --argjson size "$size" '{
    schemaVersion: "object-manifest-entry/1.0",
    keyBase64: ($key | @base64),
    sizeBytes: $size,
    sha256: $sha,
    declaredSha256: null,
    declaredSha256Status: "missing",
    etag: null,
    versionId: null,
    metadata: {},
    checksum: null,
    encryption: null,
    retention: null,
    legalHold: null
  }'
}

valid_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
other_sha='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
entry '2026/07/123e4567-e89b-42d3-a456-426614174000.pdf' 100 "$valid_sha" > "$root/expected.jsonl"
cp "$root/expected.jsonl" "$root/actual.jsonl"
compare_object_manifests "$root/expected.jsonl" "$root/actual.jsonl"

assert_rejected() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    integrity_fail "self_test_did_not_reject_$label"
  fi
}

entry '2026/07/223e4567-e89b-42d3-a456-426614174000.pdf' 100 "$valid_sha" > "$root/wrong-key.jsonl"
assert_rejected wrong_key compare_object_manifests "$root/expected.jsonl" "$root/wrong-key.jsonl"
entry '2026/07/123e4567-e89b-42d3-a456-426614174000.pdf' 101 "$valid_sha" > "$root/wrong-size.jsonl"
assert_rejected wrong_size compare_object_manifests "$root/expected.jsonl" "$root/wrong-size.jsonl"
entry '2026/07/123e4567-e89b-42d3-a456-426614174000.pdf' 100 "$other_sha" > "$root/wrong-content.jsonl"
assert_rejected same_size_wrong_content compare_object_manifests "$root/expected.jsonl" "$root/wrong-content.jsonl"
: > "$root/missing.jsonl"
assert_rejected missing_object compare_object_manifests "$root/expected.jsonl" "$root/missing.jsonl"
cp "$root/expected.jsonl" "$root/extra.jsonl"
entry '2026/07/323e4567-e89b-42d3-a456-426614174000.pdf' 1 "$valid_sha" >> "$root/extra.jsonl"
assert_rejected extra_object compare_object_manifests "$root/expected.jsonl" "$root/extra.jsonl"

jq -cnS --arg key '2026/07/123e4567-e89b-42d3-a456-426614174000.pdf' --arg sha "$valid_sha" '{
  rawFileId: "raw-1", keyBase64: ($key | @base64), sizeBytes: 100, sha256: $sha
}' > "$root/refs.jsonl"
verify_database_object_refs_file "$root/refs.jsonl" "$root/expected.jsonl"
jq '.sizeBytes = 99' "$root/refs.jsonl" > "$root/dangling-refs.jsonl"
assert_rejected dangling_database_ref verify_database_object_refs_file "$root/dangling-refs.jsonl" "$root/expected.jsonl"

printf '{"schemaVersion":"backup-manifest/1.0"}\n' > "$root/manifest.json"
write_sha256_sidecar "$root/manifest.json" "$root/manifest.sha256"
verify_sha256_sidecar "$root/manifest.json" "$root/manifest.sha256"
printf ' ' >> "$root/manifest.json"
assert_rejected manifest_tamper verify_sha256_sidecar "$root/manifest.json" "$root/manifest.sha256"

printf '{"objects":{"count":7}}\n' > "$root/legacy.json"
assert_rejected legacy_manifest validate_backup_manifest "$root/legacy.json"

jq -cnS '{status:"passed", cases:9, strongHashCases:6, databaseReferenceCases:1, manifestCases:2}'
