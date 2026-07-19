import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import { IMPORT_TRANSFORM_REGISTRY_VERSION } from './import-transform-registry';

export const EXCEL_STRUCTURE_FINGERPRINT_VERSION = 'excel-structure-fingerprint/1.0';
export const MAPPING_PROFILE_POLICY_VERSION = 'mapping-profile-policy/1.0';

export interface MappingProfileSheetInput {
  sheetIndex: number;
  sheetName: string;
  selectedHeaderRows: unknown;
  mergedRanges: unknown;
}

export interface MappingProfileColumnInput {
  sourceColumnId: string | null;
  columnIndex: number;
  columnLetter: string | null;
  headerParts: unknown;
  normalizedName: string;
  inferredType: string;
}

export interface ExcelStructureFingerprintInput {
  workbookType: 'xls' | 'xlsx';
  parserVersion: string;
  templateId: string;
  templateVersion: number;
  transformRegistryVersion?: string;
  sheets: MappingProfileSheetInput[];
  columns: MappingProfileColumnInput[];
}

export interface MappingProfileRuleSnapshot {
  sourceColumnId: string;
  columnIndex: number;
  normalizedSourceName: string;
  sourceInferredType: string;
  targetFieldId: string | null;
  transformKey: string;
  ignored: boolean;
}

export function buildExcelStructureFingerprint(input: ExcelStructureFingerprintInput) {
  const transformRegistryVersion = input.transformRegistryVersion ?? IMPORT_TRANSFORM_REGISTRY_VERSION;
  const payload = {
    schemaVersion: EXCEL_STRUCTURE_FINGERPRINT_VERSION,
    workbookType: input.workbookType,
    parserMajorVersion: normalizeParserMajor(input.parserVersion),
    template: {
      id: input.templateId,
      version: input.templateVersion
    },
    transformRegistryVersion,
    sheets: [...input.sheets]
      .sort((left, right) => left.sheetIndex - right.sheetIndex)
      .map((sheet) => ({
        sheetIndex: sheet.sheetIndex,
        sheetName: normalizeStructuralText(sheet.sheetName),
        selectedHeaderRows: normalizeIntegerArray(sheet.selectedHeaderRows),
        mergedRanges: normalizeStringArray(sheet.mergedRanges, normalizeRange).sort()
      })),
    columns: [...input.columns]
      .sort((left, right) => left.columnIndex - right.columnIndex)
      .map((column) => ({
        sourceColumnId: normalizeStructuralText(column.sourceColumnId ?? `column:${column.columnIndex}`),
        columnIndex: column.columnIndex,
        columnLetter: normalizeStructuralText(column.columnLetter ?? ''),
        headerParts: normalizeStringArray(column.headerParts, normalizeStructuralText),
        normalizedHeader: normalizeStructuralText(column.normalizedName),
        inferredType: normalizeStructuralText(column.inferredType)
      }))
  };
  return {
    fingerprint: canonicalJsonSha256(payload),
    fingerprintVersion: EXCEL_STRUCTURE_FINGERPRINT_VERSION,
    transformRegistryVersion,
    payload
  };
}

export function buildMappingProfileScopeKey(input: {
  projectId: string;
  templateId: string;
  templateVersion: number;
  structureFingerprint: string;
  transformRegistryVersion: string;
  policyVersion?: string;
}) {
  return canonicalJsonSha256({
    projectId: input.projectId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    structureFingerprint: input.structureFingerprint,
    transformRegistryVersion: input.transformRegistryVersion,
    policyVersion: input.policyVersion ?? MAPPING_PROFILE_POLICY_VERSION
  });
}

export function buildMappingProfileSnapshotHash(input: {
  scopeKey: string;
  profileVersion: number;
  rules: MappingProfileRuleSnapshot[];
}) {
  return canonicalJsonSha256({
    schemaVersion: 'mapping-profile-snapshot/1.0',
    scopeKey: input.scopeKey,
    profileVersion: input.profileVersion,
    rules: [...input.rules]
      .sort((left, right) => left.columnIndex - right.columnIndex || left.sourceColumnId.localeCompare(right.sourceColumnId))
      .map((rule) => ({
        sourceColumnId: normalizeStructuralText(rule.sourceColumnId),
        columnIndex: rule.columnIndex,
        normalizedSourceName: normalizeStructuralText(rule.normalizedSourceName),
        sourceInferredType: normalizeStructuralText(rule.sourceInferredType),
        targetFieldId: rule.targetFieldId,
        transformKey: rule.transformKey,
        ignored: rule.ignored
      }))
  });
}

export function normalizeStructuralText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeParserMajor(value: string) {
  const normalized = normalizeStructuralText(value);
  const semanticMajor = normalized.match(/^(.*?)(?:[./_-]?v?)(\d+)(?:[.].*)?$/);
  return semanticMajor ? `${semanticMajor[1].replace(/[./_-]+$/, '')}/v${semanticMajor[2]}` : normalized;
}

function normalizeIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0))].sort((a, b) => a - b);
}

function normalizeStringArray(value: unknown, normalize: (item: string) => string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(normalize)
    .filter(Boolean);
}

function normalizeRange(value: string) {
  return value.normalize('NFKC').replace(/[$\s]/g, '').toUpperCase();
}
