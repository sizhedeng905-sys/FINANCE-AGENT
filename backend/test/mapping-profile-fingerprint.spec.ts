import {
  buildExcelStructureFingerprint,
  buildMappingProfileScopeKey,
  buildMappingProfileSnapshotHash,
  EXCEL_STRUCTURE_FINGERPRINT_VERSION
} from '../src/import-tasks/mapping-profile-fingerprint';
import { IMPORT_TRANSFORM_REGISTRY_VERSION } from '../src/import-tasks/import-transform-registry';

const baseInput = () => ({
  workbookType: 'xlsx' as const,
  parserVersion: 'exceljs-evidence-v1.4.2',
  templateId: 'template-a',
  templateVersion: 3,
  sheets: [{
    sheetIndex: 0,
    sheetName: ' 运输 明细 ',
    selectedHeaderRows: [2, 1],
    mergedRanges: ['$C$1:$D$1', 'A1:B1']
  }],
  columns: [
    {
      sourceColumnId: 'sheet0:B',
      columnIndex: 1,
      columnLetter: 'B',
      headerParts: ['费用', '金额'],
      normalizedName: '费用/金额',
      inferredType: 'decimal-string'
    },
    {
      sourceColumnId: 'sheet0:A',
      columnIndex: 0,
      columnLetter: 'A',
      headerParts: ['日期'],
      normalizedName: '日期',
      inferredType: 'date-string'
    }
  ]
});

describe('mapping profile structure fingerprint', () => {
  it('is stable across non-semantic Unicode, whitespace and metadata ordering differences', () => {
    const first = buildExcelStructureFingerprint(baseInput());
    const equivalent = baseInput();
    equivalent.sheets[0].sheetName = '运输　明细';
    equivalent.sheets[0].selectedHeaderRows = [1, 2, 2];
    equivalent.sheets[0].mergedRanges = ['a1:b1', ' C1:D1 '];
    equivalent.columns = [...equivalent.columns].reverse();

    const second = buildExcelStructureFingerprint(equivalent);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprintVersion).toBe(EXCEL_STRUCTURE_FINGERPRINT_VERSION);
    expect(first.transformRegistryVersion).toBe(IMPORT_TRANSFORM_REGISTRY_VERSION);
  });

  it.each([
    ['column order', (input: ReturnType<typeof baseInput>) => {
      input.columns[0].columnIndex = 0;
      input.columns[1].columnIndex = 1;
    }],
    ['inferred type', (input: ReturnType<typeof baseInput>) => {
      input.columns[0].inferredType = 'text';
    }],
    ['merged header', (input: ReturnType<typeof baseInput>) => {
      input.sheets[0].mergedRanges = ['A1:C1'];
    }],
    ['template version', (input: ReturnType<typeof baseInput>) => {
      input.templateVersion += 1;
    }],
    ['transform version', (input: ReturnType<typeof baseInput>) => {
      Object.assign(input, { transformRegistryVersion: 'import-transform-registry/2.0' });
    }]
  ])('changes when the %s changes', (_label, mutate) => {
    const first = buildExcelStructureFingerprint(baseInput());
    const changed = baseInput();
    mutate(changed);
    expect(buildExcelStructureFingerprint(changed).fingerprint).not.toBe(first.fingerprint);
  });

  it('scopes exact structures by project and policy', () => {
    const structure = buildExcelStructureFingerprint(baseInput());
    const common = {
      templateId: 'template-a',
      templateVersion: 3,
      structureFingerprint: structure.fingerprint,
      transformRegistryVersion: structure.transformRegistryVersion
    };
    const first = buildMappingProfileScopeKey({ ...common, projectId: 'project-a' });
    expect(buildMappingProfileScopeKey({ ...common, projectId: 'project-a' })).toBe(first);
    expect(buildMappingProfileScopeKey({ ...common, projectId: 'project-b' })).not.toBe(first);
    expect(buildMappingProfileScopeKey({ ...common, projectId: 'project-a', policyVersion: 'policy/2' })).not.toBe(first);
  });

  it('hashes the approved mapping snapshot deterministically and detects rule changes', () => {
    const rules = [
      {
        sourceColumnId: 'sheet0:B',
        columnIndex: 1,
        normalizedSourceName: '金额',
        sourceInferredType: 'decimal-string',
        targetFieldId: 'amount',
        transformKey: 'DECIMAL_CANONICAL_V1',
        ignored: false
      },
      {
        sourceColumnId: 'sheet0:A',
        columnIndex: 0,
        normalizedSourceName: '日期',
        sourceInferredType: 'date-string',
        targetFieldId: 'date',
        transformKey: 'DATE_ISO_WITH_LOCALE_V1',
        ignored: false
      }
    ];
    const first = buildMappingProfileSnapshotHash({ scopeKey: 'a'.repeat(64), profileVersion: 1, rules });
    expect(buildMappingProfileSnapshotHash({
      scopeKey: 'a'.repeat(64),
      profileVersion: 1,
      rules: [...rules].reverse()
    })).toBe(first);
    expect(buildMappingProfileSnapshotHash({
      scopeKey: 'a'.repeat(64),
      profileVersion: 1,
      rules: rules.map((rule, index) => index === 0 ? { ...rule, targetFieldId: 'other' } : rule)
    })).not.toBe(first);
  });
});
