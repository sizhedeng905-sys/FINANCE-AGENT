#!/bin/bash

BACKUP_MANIFEST_SCHEMA='backup-manifest/1.0'
BACKUP_TOOL_VERSION='finance-agent-backup-r4-v1'

integrity_fail() {
  printf 'backup_integrity_error:%s\n' "$1" >&2
  return 1
}

require_integrity_tools() {
  local command_name
  for command_name in jq mc sha256sum base64 sort cmp pg_dump psql; do
    command -v "$command_name" >/dev/null 2>&1 || integrity_fail "missing_tool_$command_name" || return 1
  done
}

assert_backup_id() {
  [[ "${1:-}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || integrity_fail 'invalid_backup_id'
}

assert_storage_key() {
  local key="${1:-}"
  [[ "$key" =~ ^[0-9]{4}/(0[1-9]|1[0-2])/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\.(csv|docx|jpe?g|pdf|png|webp|xlsx?)$ ]] \
    || integrity_fail 'unsafe_object_key'
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

file_bytes() {
  stat -c %s "$1"
}

write_sha256_sidecar() {
  local file="$1"
  local sidecar="$2"
  printf '%s  %s\n' "$(sha256_file "$file")" "$(basename "$file")" > "$sidecar"
}

verify_sha256_sidecar() {
  local file="$1"
  local sidecar="$2"
  local expected_name expected_sha actual_sha extra
  [[ -s "$file" && -s "$sidecar" ]] || integrity_fail 'manifest_or_sidecar_missing' || return 1
  read -r expected_sha expected_name extra < "$sidecar"
  expected_name="${expected_name#\*}"
  [[ -z "${extra:-}" && "$expected_name" == "$(basename "$file")" && "$expected_sha" =~ ^[0-9a-f]{64}$ ]] \
    || integrity_fail 'manifest_sidecar_invalid' || return 1
  actual_sha="$(sha256_file "$file")"
  [[ "$actual_sha" == "$expected_sha" ]] || integrity_fail 'manifest_sha256_mismatch'
}

canonicalize_json_lines() {
  local input="$1"
  local output="$2"
  local temporary="${output}.tmp.$$"
  jq -cS . "$input" | LC_ALL=C sort > "$temporary"
  mv "$temporary" "$output"
}

generate_object_manifest() {
  local object_root="$1"
  local output="$2"
  local root_tail root_prefix listed_key
  local listed="${output}.listed.$$"
  local records="${output}.records.$$"
  local line key_base64 listed_size key stat_json stat_size content_sha record
  : > "$records"
  root_tail="${object_root#*/}"
  root_prefix=''
  if [[ "$root_tail" == */* ]]; then
    root_prefix="${root_tail#*/}"
    root_prefix="${root_prefix%/}"
  fi
  mc ls --recursive --json "$object_root" > "$listed"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    jq -e '.status == "success" and (.type == "file" or .type == "folder")' >/dev/null <<< "$line" \
      || { rm -f "$listed" "$records"; integrity_fail 'object_listing_invalid'; return 1; }
    [[ "$(jq -r '.type' <<< "$line")" == 'file' ]] || continue
    listed_key="$(jq -r '.key' <<< "$line")"
    key="$listed_key"
    if [[ -n "$root_prefix" && "$key" == "$root_prefix/"* ]]; then
      key="${key#"$root_prefix/"}"
    fi
    key_base64="$(printf '%s' "$key" | base64 -w 0)"
    listed_size="$(jq -r '.size' <<< "$line")"
    [[ "$listed_size" =~ ^[0-9]+$ ]] \
      || { rm -f "$listed" "$records"; integrity_fail 'object_size_invalid'; return 1; }
    assert_storage_key "$key" \
      || { rm -f "$listed" "$records"; return 1; }
    stat_json="$(mc stat --json "$object_root/$key")"
    jq -e '.status == "success" and .type == "file" and (.size | type == "number")' >/dev/null <<< "$stat_json" \
      || { rm -f "$listed" "$records"; integrity_fail 'object_stat_invalid'; return 1; }
    stat_size="$(jq -r '.size' <<< "$stat_json")"
    [[ "$stat_size" == "$listed_size" ]] \
      || { rm -f "$listed" "$records"; integrity_fail 'object_changed_during_manifest'; return 1; }
    content_sha="$(mc cat "$object_root/$key" | sha256sum | awk '{print $1}')"
    [[ "$content_sha" =~ ^[0-9a-f]{64}$ ]] \
      || { rm -f "$listed" "$records"; integrity_fail 'object_content_hash_failed'; return 1; }
    record="$(jq -cS \
      --arg keyBase64 "$key_base64" \
      --arg sha256 "$content_sha" \
      '((.metadata // {} | to_entries | map(select(
        (.key | ascii_downcase) == "x-amz-meta-sha256" or (.key | ascii_downcase) == "sha256"
      )) | .[0].value) // null) as $declaredSha256 |
      {
        schemaVersion: "object-manifest-entry/1.0",
        keyBase64: $keyBase64,
        sizeBytes: .size,
        sha256: $sha256,
        declaredSha256: $declaredSha256,
        declaredSha256Status: (
          if $declaredSha256 == null then "missing"
          elif $declaredSha256 == $sha256 then "matched"
          else "mismatch"
          end
        ),
        etag: (.etag // null),
        versionId: (.versionID // null),
        metadata: (.metadata // {}),
        checksum: (.checksum // null),
        encryption: (.encryption // null),
        retention: (.retention // null),
        legalHold: (.legalHold // null)
      }' <<< "$stat_json")"
    printf '%s\n' "$record" >> "$records"
  done < "$listed"
  canonicalize_json_lines "$records" "$output"
  rm -f "$listed" "$records"
  validate_object_manifest "$output"
}

validate_object_manifest() {
  local manifest="$1"
  jq -s -e '
    all(.[];
      .schemaVersion == "object-manifest-entry/1.0" and
      (.keyBase64 | type == "string" and length > 0) and
      (.sizeBytes | type == "number" and . >= 0 and floor == .) and
      (.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
      (.declaredSha256Status == "missing" or .declaredSha256Status == "matched" or .declaredSha256Status == "mismatch") and
      (.metadata | type == "object")
    ) and
    ((map(.keyBase64) | unique | length) == length)
  ' "$manifest" >/dev/null || integrity_fail 'object_manifest_invalid'
}

object_manifest_projection() {
  local input="$1"
  local output="$2"
  jq -cS '{
    keyBase64,
    sizeBytes,
    sha256,
    metadata,
    encryption,
    retention,
    legalHold
  }' "$input" | LC_ALL=C sort > "$output"
}

compare_object_manifests() {
  local expected="$1"
  local actual="$2"
  local expected_projection="${expected}.projection.$$"
  local actual_projection="${actual}.projection.$$"
  validate_object_manifest "$expected" || return 1
  validate_object_manifest "$actual" || return 1
  object_manifest_projection "$expected" "$expected_projection"
  object_manifest_projection "$actual" "$actual_projection"
  if ! cmp -s "$expected_projection" "$actual_projection"; then
    rm -f "$expected_projection" "$actual_projection"
    integrity_fail 'object_manifest_mismatch'
    return 1
  fi
  rm -f "$expected_projection" "$actual_projection"
}

verify_object_manifest() {
  local expected="$1"
  local object_root="$2"
  local observed
  observed="$(mktemp)"
  generate_object_manifest "$object_root" "$observed" \
    || { rm -f "$observed"; return 1; }
  compare_object_manifests "$expected" "$observed" \
    || { rm -f "$observed"; return 1; }
  rm -f "$observed"
}

generate_database_object_refs() {
  local database_url="$1"
  local output="$2"
  local raw="${output}.raw.$$"
  psql "$database_url" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command "
    SELECT json_build_object(
      'rawFileId', id,
      'keyBase64', translate(encode(convert_to(storage_path, 'UTF8'), 'base64'), E'\\n', ''),
      'sizeBytes', file_size,
      'sha256', sha256
    )::text
    FROM raw_files
    WHERE is_voided = false
    ORDER BY storage_path, id;
  " > "$raw"
  canonicalize_json_lines "$raw" "$output"
  rm -f "$raw"
  jq -s -e '
    all(.[];
      (.rawFileId | type == "string" and length > 0) and
      (.keyBase64 | type == "string" and length > 0) and
      (.sizeBytes | type == "number" and . >= 0 and floor == .) and
      (.sha256 | type == "string" and test("^[0-9a-f]{64}$"))
    )
  ' "$output" >/dev/null || integrity_fail 'database_object_refs_invalid'
}

verify_database_object_refs_file() {
  local refs="$1"
  local object_manifest="$2"
  validate_object_manifest "$object_manifest" || return 1
  jq -s -e --slurpfile objects "$object_manifest" '
    ($objects | reduce .[] as $object ({}; .[$object.keyBase64] = $object)) as $byKey |
    [ .[] | select(
      ($byKey[.keyBase64] == null) or
      ($byKey[.keyBase64].sizeBytes != .sizeBytes) or
      ($byKey[.keyBase64].sha256 != .sha256)
    ) ] as $invalid |
    if ($invalid | length) == 0 then
      {status: "passed", checkedReferences: length}
    else
      error("dangling_or_mismatched_database_object_reference")
    end
  ' "$refs" >/dev/null || integrity_fail 'database_object_reference_mismatch'
}

generate_migration_manifest() {
  local database_url="$1"
  local output="$2"
  local raw="${output}.raw.$$"
  psql "$database_url" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command "
    SELECT json_build_object(
      'migrationName', migration_name,
      'checksum', checksum,
      'finishedAt', to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')
    )::text
    FROM _prisma_migrations
    WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL
    ORDER BY migration_name;
  " > "$raw"
  canonicalize_json_lines "$raw" "$output"
  rm -f "$raw"
  jq -s -e 'all(.[]; (.migrationName | type == "string") and (.checksum | type == "string"))' "$output" >/dev/null \
    || integrity_fail 'migration_manifest_invalid'
}

generate_schema_snapshot() {
  local database_url="$1"
  local output="$2"
  local raw="${output}.raw.$$"
  pg_dump "$database_url" --schema-only --no-owner --no-acl --file "$raw"
  sed -E '/^\\(un)?restrict [A-Za-z0-9]+$/d' "$raw" > "$output"
  rm -f "$raw"
  [[ -s "$output" ]] || integrity_fail 'database_schema_snapshot_empty'
}

verify_database_object_refs() {
  local database_url="$1"
  local expected_refs="$2"
  local object_manifest="$3"
  local observed
  observed="$(mktemp)"
  generate_database_object_refs "$database_url" "$observed" \
    || { rm -f "$observed"; return 1; }
  if ! cmp -s "$expected_refs" "$observed"; then
    rm -f "$observed"
    integrity_fail 'restored_database_object_refs_changed'
    return 1
  fi
  rm -f "$observed"
  verify_database_object_refs_file "$expected_refs" "$object_manifest"
}

validate_backup_manifest() {
  local manifest="$1"
  local schema
  schema="$(jq -r '.schemaVersion // "legacy"' "$manifest" 2>/dev/null || printf 'invalid')"
  if [[ "$schema" != "$BACKUP_MANIFEST_SCHEMA" ]]; then
    local legacy_count
    legacy_count="$(jq -r '.objects.count // 0' "$manifest" 2>/dev/null || printf '0')"
    integrity_fail "legacy_manifest_unverified_content:count=$legacy_count"
    return 1
  fi
  jq -e '
    .schemaVersion == "backup-manifest/1.0" and
    .toolVersion == "finance-agent-backup-r4-v1" and
    (.backupId | test("^[0-9]{8}T[0-9]{6}Z$")) and
    (.anonymousEnvironmentId | test("^[0-9a-f]{64}$")) and
    .database.dump.path == "database.dump" and
    .database.schema.path == "database-schema.sql" and
    .database.migrations.path == "database-migrations.jsonl" and
    .database.objectReferences.path == "database-object-refs.jsonl" and
    .sourceObjects.path == "source-object-manifest.jsonl" and
    .objects.path == "object-manifest.jsonl" and
    .objects.manifestPath == "object-manifest.jsonl" and
    (.objects.count | type == "number" and . >= 0 and floor == .) and
    (.objects.strongHashVerifiedCount == .objects.count) and
    (.objects.strongHashUnverifiedCount == 0) and
    ((.objects.metadataDigestMatchedCount + .objects.metadataDigestMissingCount + .objects.metadataDigestMismatchCount) == .objects.count) and
    .integrity.manifestSidecar == "manifest.sha256"
  ' "$manifest" >/dev/null || integrity_fail 'backup_manifest_invalid'
}

verify_artifact() {
  local backup_dir="$1"
  local manifest="$2"
  local selector="$3"
  local path expected_sha expected_bytes actual_sha actual_bytes
  path="$(jq -r "$selector.path" "$manifest")"
  expected_sha="$(jq -r "$selector.sha256" "$manifest")"
  expected_bytes="$(jq -r "$selector.bytes" "$manifest")"
  [[ "$path" =~ ^[a-z0-9][a-z0-9._-]*$ && "$expected_sha" =~ ^[0-9a-f]{64}$ && "$expected_bytes" =~ ^[0-9]+$ ]] \
    || integrity_fail 'artifact_descriptor_invalid' || return 1
  [[ -f "$backup_dir/$path" ]] || integrity_fail 'artifact_missing' || return 1
  actual_sha="$(sha256_file "$backup_dir/$path")"
  actual_bytes="$(file_bytes "$backup_dir/$path")"
  [[ "$actual_sha" == "$expected_sha" && "$actual_bytes" == "$expected_bytes" ]] \
    || integrity_fail "artifact_integrity_mismatch_$path"
}

verify_backup_bundle() {
  local backup_dir="$1"
  local object_root="$2"
  local restored_database_url="${3:-}"
  local manifest="$backup_dir/manifest.json"
  verify_sha256_sidecar "$manifest" "$backup_dir/manifest.sha256" || return 1
  validate_backup_manifest "$manifest" || return 1
  [[ "$(jq -r '.backupId' "$manifest")" == "$(basename "$backup_dir")" ]] \
    || integrity_fail 'backup_directory_id_mismatch' || return 1
  verify_artifact "$backup_dir" "$manifest" '.database.dump' || return 1
  verify_artifact "$backup_dir" "$manifest" '.database.schema' || return 1
  verify_artifact "$backup_dir" "$manifest" '.database.migrations' || return 1
  verify_artifact "$backup_dir" "$manifest" '.database.objectReferences' || return 1
  verify_artifact "$backup_dir" "$manifest" '.sourceObjects' || return 1
  verify_artifact "$backup_dir" "$manifest" '.objects' || return 1
  pg_restore --list "$backup_dir/database.dump" >/dev/null || integrity_fail 'database_dump_unreadable' || return 1
  verify_object_manifest "$backup_dir/object-manifest.jsonl" "$object_root" || return 1
  if [[ -n "$restored_database_url" ]]; then
    local observed_schema observed_migrations
    observed_schema="$(mktemp)"
    observed_migrations="$(mktemp)"
    generate_schema_snapshot "$restored_database_url" "$observed_schema" \
      || { rm -f "$observed_schema" "$observed_migrations"; return 1; }
    generate_migration_manifest "$restored_database_url" "$observed_migrations" \
      || { rm -f "$observed_schema" "$observed_migrations"; return 1; }
    if ! cmp -s "$backup_dir/database-schema.sql" "$observed_schema"; then
      rm -f "$observed_schema" "$observed_migrations"
      integrity_fail 'restored_database_schema_mismatch'
      return 1
    fi
    if ! cmp -s "$backup_dir/database-migrations.jsonl" "$observed_migrations"; then
      rm -f "$observed_schema" "$observed_migrations"
      integrity_fail 'restored_database_migration_mismatch'
      return 1
    fi
    rm -f "$observed_schema" "$observed_migrations"
    verify_database_object_refs "$restored_database_url" "$backup_dir/database-object-refs.jsonl" "$backup_dir/object-manifest.jsonl" \
      || return 1
  fi
}
