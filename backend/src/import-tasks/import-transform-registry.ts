export const IMPORT_TRANSFORM_REGISTRY_VERSION = 'import-transform-registry/1.0';

export const IMPORT_TRANSFORM_KEYS = [
  'IDENTITY_V1',
  'TRIM_TEXT_V1',
  'DECIMAL_CANONICAL_V1',
  'DATE_ISO_WITH_LOCALE_V1',
  'ENUM_ALIAS_LOOKUP_V1',
  'PROJECT_ALIAS_LOOKUP_V1'
] as const;

export type ImportTransformKey = typeof IMPORT_TRANSFORM_KEYS[number];

const IMPORT_TRANSFORM_KEY_SET = new Set<string>(IMPORT_TRANSFORM_KEYS);

export function isRegisteredImportTransformKey(value: string): value is ImportTransformKey {
  return IMPORT_TRANSFORM_KEY_SET.has(value);
}
