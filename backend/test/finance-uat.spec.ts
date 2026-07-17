import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFinanceUatTestDatabase,
  buildFinanceUatReport,
  createBlankFinanceUatManifest,
  FinanceUatSnapshot,
  validateFinanceUatManifest
} from '../scripts/finance-uat-lib';

describe('B8-08 finance UAT tooling', () => {
  it('validates both the generated blank manifest and the tracked anonymous example', () => {
    expect(validateFinanceUatManifest(createBlankFinanceUatManifest()).cases).toHaveLength(8);

    const example = JSON.parse(readFileSync(
      resolve(__dirname, '..', '..', 'docs', 'templates', 'B8_08_UAT_MANIFEST.example.json'),
      'utf8'
    )) as unknown;
    expect(validateFinanceUatManifest(example).signoffs).toHaveLength(4);
  });

  it('rejects missing scenarios, fabricated signoff evidence, and unknown issue references', () => {
    const duplicateScenario = createBlankFinanceUatManifest();
    duplicateScenario.cases[7].id = 'UAT-07';
    expect(() => validateFinanceUatManifest(duplicateScenario)).toThrow('scenario IDs');

    const fabricatedSignoff = createBlankFinanceUatManifest();
    fabricatedSignoff.signoffs[0].approvalRef = 'approval-without-decision';
    expect(() => validateFinanceUatManifest(fabricatedSignoff)).toThrow('cannot contain approval evidence');

    const ambiguousSignoffTime = createBlankFinanceUatManifest();
    ambiguousSignoffTime.signoffs[0] = {
      role: 'finance', status: 'passed', approvalRef: 'approval-001', decidedAt: '2026-07-17 12:00:00'
    };
    expect(() => validateFinanceUatManifest(ambiguousSignoffTime)).toThrow('ISO-8601 UTC');

    const unknownIssue = createBlankFinanceUatManifest();
    unknownIssue.cases[0].issueRefs = ['UAT-ISSUE-001'];
    expect(() => validateFinanceUatManifest(unknownIssue)).toThrow('unknown issue');
  });

  it('refuses non-PostgreSQL and non-test databases', () => {
    expect(assertFinanceUatTestDatabase('postgresql://localhost:5432/finance_agent_uat_test')).toBe('finance_agent_uat_test');
    expect(() => assertFinanceUatTestDatabase('postgresql://localhost:5432/finance_agent')).toThrow('refuses non-test');
    expect(() => assertFinanceUatTestDatabase('mysql://localhost/finance_agent_uat_test')).toThrow('only supports PostgreSQL');
  });

  it('reconciles large fixed-2 amounts by integer cents and omits business fields', () => {
    const manifest = createBlankFinanceUatManifest();
    const testCase = manifest.cases.find((item) => item.id === 'UAT-05')!;
    testCase.recordIds = ['record_income_0001', 'record_expense_001'];
    testCase.expected = {
      ...testCase.expected,
      recordCount: 2,
      invalidRecordCount: 0,
      income: '90071992547409.91',
      expense: '0.09',
      profit: '90071992547409.82',
      auditCoveredRecordCount: 2,
      ledgerCoveredRecordCount: 2,
      exactDuplicateSourceGroups: 0
    };
    const snapshot: FinanceUatSnapshot = {
      records: [
        {
          id: 'record_income_0001', status: 'confirmed', dataLayer: 'actual',
          accountingDirection: 'income', amount: '90071992547409.91',
          sourceType: 'excel', sourceId: 'anonymous-source-1', customerName: 'SECRET_CUSTOMER'
        } as FinanceUatSnapshot['records'][number],
        {
          id: 'record_expense_001', status: 'confirmed', dataLayer: 'actual',
          accountingDirection: 'expense', amount: '0.09',
          sourceType: 'ocr', sourceId: 'anonymous-source-2', description: 'SECRET_DESCRIPTION'
        } as FinanceUatSnapshot['records'][number]
      ],
      importTasks: [],
      ocrTasks: [],
      auditRecordIds: [...testCase.recordIds],
      ledgerRecordIds: [...testCase.recordIds]
    };

    const report = buildFinanceUatReport(manifest, snapshot, new Date('2026-07-17T00:00:00.000Z'));
    const result = report.cases.find((item) => item.id === 'UAT-05')!;
    expect(result.status).toBe('passed');
    expect(result.actual).toMatchObject({
      income: '90071992547409.91', expense: '0.09', profit: '90071992547409.82'
    });
    expect(report.automaticStatus).toBe('partial');
    expect(report.humanGateStatus).toBe('external_unverified');
    expect(JSON.stringify(report)).not.toContain('SECRET_CUSTOMER');
    expect(JSON.stringify(report)).not.toContain('SECRET_DESCRIPTION');
  });

  it('fails closed for missing evidence and requires an open issue reference', () => {
    const manifest = createBlankFinanceUatManifest();
    const testCase = manifest.cases.find((item) => item.id === 'UAT-01')!;
    testCase.recordIds = ['missing_record_0001'];
    testCase.expected.recordCount = 1;

    const report = buildFinanceUatReport(manifest, emptySnapshot());
    expect(report.automaticStatus).toBe('failed');
    expect(report.untrackedFailures).toEqual(['UAT-01']);
    expect(JSON.stringify(report)).not.toContain('missing_record_0001');

    manifest.issues.push({
      id: 'UAT-ISSUE-001', scenarioId: 'UAT-01', severity: 'P1', status: 'open',
      ownerRole: 'finance', summary: '匿名记录证据缺失', evidenceRef: null, resolutionRef: null
    });
    testCase.issueRefs = ['UAT-ISSUE-001'];
    validateFinanceUatManifest(manifest);
    expect(buildFinanceUatReport(manifest, emptySnapshot()).untrackedFailures).toEqual([]);
  });
});

function emptySnapshot(): FinanceUatSnapshot {
  return { records: [], importTasks: [], ocrTasks: [], auditRecordIds: [], ledgerRecordIds: [] };
}
