ALTER TABLE "mapping_profile_rules"
  ADD CONSTRAINT "mapping_profile_rules_transform_contract" CHECK (
    "column_index" >= 0
    AND "transform_key" IN (
      'IDENTITY_V1',
      'TRIM_TEXT_V1',
      'DECIMAL_CANONICAL_V1',
      'DATE_ISO_WITH_LOCALE_V1',
      'ENUM_ALIAS_LOOKUP_V1',
      'PROJECT_ALIAS_LOOKUP_V1'
    )
  );

ALTER TABLE "mapping_profiles"
  ADD CONSTRAINT "mapping_profiles_status_activity_contract" CHECK (
    ("status" = 'active' AND "is_active" = TRUE)
    OR ("status" IN ('stale', 'revoked') AND "is_active" = FALSE)
  );
