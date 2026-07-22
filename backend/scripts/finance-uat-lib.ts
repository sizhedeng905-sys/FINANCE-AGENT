import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const FINANCE_UAT_SCENARIO_IDS = [
  'UAT-01',
  'UAT-02',
  'UAT-03',
  'UAT-04',
  'UAT-05',
  'UAT-06',
  'UAT-07',
  'UAT-08'
] as const;

export type FinanceUatScenarioId = (typeof FINANCE_UAT_SCENARIO_IDS)[number];
export type FinanceUatHumanStatus = 'awaiting_human' | 'ready' | 'passed' | 'conditional' | 'failed' | 'blocked';
export type FinanceUatSignoffRole = 'finance' | 'business' | 'boss' | 'security';

export interface FinanceUatExpected {
  recordCount: number | null;
  invalidRecordCount: number | null;
  income: string | null;
  expense: string | null;
  profit: string | null;
  auditCoveredRecordCount: number | null;
  ledgerCoveredRecordCount: number | null;
  exactDuplicateSourceGroups: number | null;
  importTaskCount: number | null;
  importedRows: number | null;
  ocrTaskCount: number | null;
  ocrCorrectionCount: number | null;
  ocrGeneratedRecordCount: number | null;
}

export interface FinanceUatCase {
  id: FinanceUatScenarioId;
  title: string;
  ownerRoles: FinanceUatSignoffRole[];
  status: FinanceUatHumanStatus;
  sampleIds: string[];
  recordIds: string[];
  importTaskIds: string[];
  ocrTaskIds: string[];
  expected: FinanceUatExpected;
  humanDecisionRefs: string[];
  issueRefs: string[];
}

export interface FinanceUatManifest {
  schemaVersion: 'b8-08-v1';
  runId: string;
  dataClassification: 'synthetic' | 'anonymized';
  cases: FinanceUatCase[];
  signoffs: Array<{
    role: FinanceUatSignoffRole;
    status: 'awaiting' | 'passed' | 'conditional' | 'failed';
    approvalRef: string | null;
    decidedAt: string | null;
  }>;
  issues: Array<{
    id: string;
    scenarioId: FinanceUatScenarioId;
    severity: 'P0' | 'P1' | 'P2' | 'P3';
    status: 'open' | 'in_progress' | 'closed';
    ownerRole: FinanceUatSignoffRole;
    summary: string;
    evidenceRef: string | null;
    resolutionRef: string | null;
  }>;
}

export interface FinanceUatSnapshot {
  records: Array<{
    id: string;
    status: string;
    dataLayer: string;
    accountingDirection: string;
    amount: string;
    sourceType: string;
    sourceId: string;
  }>;
  importTasks: Array<{
    id: string;
    status: string;
    importedRows: number;
    confirmationSuccessRows: number;
    confirmationErrorRows: number;
  }>;
  ocrTasks: Array<{
    id: string;
    status: string;
    generatedRecordId: string | null;
    correctionCount: number;
  }>;
  auditRecordIds: string[];
  ledgerRecordIds: string[];
}

const nullableMoney = {
  anyOf: [{ type: 'null' }, { type: 'string', pattern: '^-?(0|[1-9][0-9]*)\\.[0-9]{2}$' }]
};
const nullableCount = { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 0 }] };
const evidenceId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$' };
const manifestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'runId', 'dataClassification', 'cases', 'signoffs', 'issues'],
  properties: {
    schemaVersion: { const: 'b8-08-v1' },
    runId: { type: 'string', pattern: '^[A-Z0-9][A-Z0-9._-]{2,63}$' },
    dataClassification: { enum: ['synthetic', 'anonymized'] },
    cases: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'title', 'ownerRoles', 'status', 'sampleIds', 'recordIds', 'importTaskIds',
          'ocrTaskIds', 'expected', 'humanDecisionRefs', 'issueRefs'
        ],
        properties: {
          id: { enum: FINANCE_UAT_SCENARIO_IDS },
          title: { type: 'string', minLength: 3, maxLength: 120 },
          ownerRoles: {
            type: 'array', minItems: 1, uniqueItems: true,
            items: { enum: ['finance', 'business', 'boss', 'security'] }
          },
          status: { enum: ['awaiting_human', 'ready', 'passed', 'conditional', 'failed', 'blocked'] },
          sampleIds: {
            type: 'array', uniqueItems: true,
            items: { type: 'string', pattern: '^sample-[a-z0-9][a-z0-9-]{2,63}$' }
          },
          recordIds: { type: 'array', uniqueItems: true, items: evidenceId },
          importTaskIds: { type: 'array', uniqueItems: true, items: evidenceId },
          ocrTaskIds: { type: 'array', uniqueItems: true, items: evidenceId },
          expected: {
            type: 'object',
            additionalProperties: false,
            required: [
              'recordCount', 'invalidRecordCount', 'income', 'expense', 'profit',
              'auditCoveredRecordCount', 'ledgerCoveredRecordCount', 'exactDuplicateSourceGroups',
              'importTaskCount', 'importedRows', 'ocrTaskCount', 'ocrCorrectionCount',
              'ocrGeneratedRecordCount'
            ],
            properties: {
              recordCount: nullableCount,
              invalidRecordCount: nullableCount,
              income: nullableMoney,
              expense: nullableMoney,
              profit: nullableMoney,
              auditCoveredRecordCount: nullableCount,
              ledgerCoveredRecordCount: nullableCount,
              exactDuplicateSourceGroups: nullableCount,
              importTaskCount: nullableCount,
              importedRows: nullableCount,
              ocrTaskCount: nullableCount,
              ocrCorrectionCount: nullableCount,
              ocrGeneratedRecordCount: nullableCount
            }
          },
          humanDecisionRefs: {
            type: 'array', uniqueItems: true,
            items: { type: 'string', pattern: '^H-[0-9]{2}$' }
          },
          issueRefs: {
            type: 'array', uniqueItems: true,
            items: { type: 'string', pattern: '^UAT-ISSUE-[0-9]{3}$' }
          }
        }
      }
    },
    signoffs: {
      type: 'array', minItems: 4, maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        required: ['role', 'status', 'approvalRef', 'decidedAt'],
        properties: {
          role: { enum: ['finance', 'business', 'boss', 'security'] },
          status: { enum: ['awaiting', 'passed', 'conditional', 'failed'] },
          approvalRef: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$' }] },
          decidedAt: { anyOf: [{ type: 'null' }, { type: 'string', format: 'date-time' }] }
        }
      }
    },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'scenarioId', 'severity', 'status', 'ownerRole', 'summary', 'evidenceRef', 'resolutionRef'],
        properties: {
          id: { type: 'string', pattern: '^UAT-ISSUE-[0-9]{3}$' },
          scenarioId: { enum: FINANCE_UAT_SCENARIO_IDS },
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
          status: { enum: ['open', 'in_progress', 'closed'] },
          ownerRole: { enum: ['finance', 'business', 'boss', 'security'] },
          summary: { type: 'string', minLength: 3, maxLength: 160 },
          evidenceRef: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 160 }] },
          resolutionRef: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 160 }] }
        }
      }
    }
  }
} as const;

const ajv = new Ajv({ allErrors: true, strict: true, formats: { 'date-time': true } });
const validateSchema = ajv.compile(manifestSchema);

export function createBlankFinanceUatManifest(runId = 'B8-08-UAT-LOCAL'): FinanceUatManifest {
  const definitions: Array<{
    id: FinanceUatScenarioId;
    title: string;
    ownerRoles: FinanceUatSignoffRole[];
    decisions: string[];
  }> = [
    { id: 'UAT-01', title: 'Excel 运输账单与逐分对账', ownerRoles: ['finance', 'business'], decisions: ['H-01', 'H-06'] },
    { id: 'UAT-02', title: '考勤劳务入账粒度与互斥', ownerRoles: ['finance', 'business'], decisions: ['H-01', 'H-02'] },
    { id: 'UAT-03', title: '报销主表与内嵌凭证归属', ownerRoles: ['finance', 'business'], decisions: ['H-07', 'H-11'] },
    { id: 'UAT-04', title: 'OCR 证据纠错与人工确认', ownerRoles: ['finance'], decisions: ['H-04', 'H-05'] },
    { id: 'UAT-05', title: '日月项目报表与人工汇总', ownerRoles: ['finance', 'boss'], decisions: ['H-06'] },
    { id: 'UAT-06', title: '老板 AI 期间口径与数字来源', ownerRoles: ['boss', 'security'], decisions: ['H-08', 'H-12'] },
    { id: 'UAT-07', title: '同源与跨来源重复业务', ownerRoles: ['finance', 'business'], decisions: ['H-03'] },
    { id: 'UAT-08', title: '冲销更正作废与历史一致性', ownerRoles: ['finance', 'business'], decisions: ['H-02'] }
  ];

  return {
    schemaVersion: 'b8-08-v1',
    runId,
    dataClassification: 'anonymized',
    cases: definitions.map((definition) => ({
      id: definition.id,
      title: definition.title,
      ownerRoles: definition.ownerRoles,
      status: 'awaiting_human',
      sampleIds: [],
      recordIds: [],
      importTaskIds: [],
      ocrTaskIds: [],
      expected: blankExpected(),
      humanDecisionRefs: definition.decisions,
      issueRefs: []
    })),
    signoffs: (['finance', 'business', 'boss', 'security'] as FinanceUatSignoffRole[]).map((role) => ({
      role,
      status: 'awaiting',
      approvalRef: null,
      decidedAt: null
    })),
    issues: []
  };
}

export function validateFinanceUatManifest(value: unknown): FinanceUatManifest {
  if (!validateSchema(value)) {
    const details = validateSchema.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`)
      .join('; ');
    throw new Error(`Invalid B8-08 UAT manifest: ${details || 'unknown schema error'}`);
  }

  const manifest = value as FinanceUatManifest;
  assertExactSet(manifest.cases.map((item) => item.id), FINANCE_UAT_SCENARIO_IDS, 'scenario IDs');
  assertExactSet(manifest.signoffs.map((item) => item.role), ['finance', 'business', 'boss', 'security'], 'signoff roles');
  assertUnique(manifest.issues.map((item) => item.id), 'issue IDs');

  const issueIds = new Set(manifest.issues.map((item) => item.id));
  for (const item of manifest.cases) {
    for (const issueRef of item.issueRefs) {
      if (!issueIds.has(issueRef)) throw new Error(`${item.id} references unknown issue ${issueRef}.`);
    }
  }
  for (const signoff of manifest.signoffs) {
    if (signoff.status === 'awaiting') {
      if (signoff.approvalRef !== null || signoff.decidedAt !== null) {
        throw new Error(`Awaiting ${signoff.role} signoff cannot contain approval evidence.`);
      }
    } else if (!signoff.approvalRef || !signoff.decidedAt) {
      throw new Error(`${signoff.role} signoff requires an external approvalRef and decidedAt.`);
    } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(signoff.decidedAt)) {
      throw new Error(`${signoff.role} signoff decidedAt must be an ISO-8601 UTC timestamp.`);
    }
  }
  for (const issue of manifest.issues) {
    if (issue.status === 'closed' && !issue.resolutionRef) {
      throw new Error(`Closed issue ${issue.id} requires resolutionRef.`);
    }
  }
  return manifest;
}

export function assertFinanceUatTestDatabase(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('B8-08 UAT requires a valid PostgreSQL DATABASE_URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('B8-08 UAT only supports PostgreSQL.');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName.endsWith('_test')) {
    throw new Error(`B8-08 UAT refuses non-test database "${databaseName || '(empty)'}".`);
  }
  return databaseName;
}

export async function collectFinanceUatSnapshot(
  prisma: PrismaClient,
  manifest: FinanceUatManifest
): Promise<FinanceUatSnapshot> {
  const recordIds = unique(manifest.cases.flatMap((item) => item.recordIds));
  const importTaskIds = unique(manifest.cases.flatMap((item) => item.importTaskIds));
  const ocrTaskIds = unique(manifest.cases.flatMap((item) => item.ocrTaskIds));

  const [records, importTasks, ocrTasks, auditLogs, ledgerEvents] = await Promise.all([
    recordIds.length === 0 ? [] : prisma.businessRecord.findMany({
      where: { id: { in: recordIds } },
      select: {
        id: true, status: true, dataLayer: true, accountingDirection: true,
        amount: true, sourceType: true, sourceId: true
      }
    }),
    importTaskIds.length === 0 ? [] : prisma.importTask.findMany({
      where: { id: { in: importTaskIds } },
      select: {
        id: true, status: true, importedRows: true,
        confirmationSuccessRows: true, confirmationErrorRows: true
      }
    }),
    ocrTaskIds.length === 0 ? [] : prisma.ocrTask.findMany({
      where: { id: { in: ocrTaskIds } },
      select: { id: true, status: true, generatedRecordId: true, _count: { select: { corrections: true } } }
    }),
    recordIds.length === 0 ? [] : prisma.auditLog.findMany({
      where: { resourceType: 'business_record', resourceId: { in: recordIds } },
      select: { resourceId: true }
    }),
    recordIds.length === 0 ? [] : prisma.ledgerEvent.findMany({
      where: { aggregateType: 'business_record', aggregateId: { in: recordIds } },
      select: { aggregateId: true }
    })
  ]);

  return {
    records: records.map((record) => ({
      ...record,
      status: String(record.status),
      dataLayer: String(record.dataLayer),
      accountingDirection: String(record.accountingDirection),
      amount: record.amount.toFixed(2),
      sourceType: String(record.sourceType)
    })),
    importTasks: importTasks.map((task) => ({ ...task, status: String(task.status) })),
    ocrTasks: ocrTasks.map((task) => ({
      id: task.id,
      status: String(task.status),
      generatedRecordId: task.generatedRecordId,
      correctionCount: task._count.corrections
    })),
    auditRecordIds: unique(auditLogs.flatMap((item) => item.resourceId ? [item.resourceId] : [])),
    ledgerRecordIds: unique(ledgerEvents.map((item) => item.aggregateId))
  };
}

export function buildFinanceUatReport(
  manifest: FinanceUatManifest,
  snapshot: FinanceUatSnapshot,
  generatedAt = new Date()
) {
  const records = new Map(snapshot.records.map((item) => [item.id, item]));
  const importTasks = new Map(snapshot.importTasks.map((item) => [item.id, item]));
  const ocrTasks = new Map(snapshot.ocrTasks.map((item) => [item.id, item]));
  const audited = new Set(snapshot.auditRecordIds);
  const ledgered = new Set(snapshot.ledgerRecordIds);
  const issues = new Map(manifest.issues.map((item) => [item.id, item]));

  const cases = manifest.cases.map((item) => {
    const selectedRecords = item.recordIds.flatMap((id) => records.get(id) ?? []);
    const selectedImports = item.importTaskIds.flatMap((id) => importTasks.get(id) ?? []);
    const selectedOcr = item.ocrTaskIds.flatMap((id) => ocrTasks.get(id) ?? []);
    const reportable = selectedRecords.filter((record) => record.status === 'confirmed' && record.dataLayer === 'actual');
    const incomeCents = sumMoney(reportable.filter((record) => record.accountingDirection === 'income').map((record) => record.amount));
    const expenseCents = sumMoney(reportable.filter((record) => record.accountingDirection === 'expense').map((record) => record.amount));
    const sourceCounts = countBy(selectedRecords, (record) => `${record.sourceType}\u0000${record.sourceId}`);
    const actual: Record<keyof FinanceUatExpected, number | string> = {
      recordCount: reportable.length,
      invalidRecordCount: selectedRecords.length - reportable.length,
      income: formatCents(incomeCents),
      expense: formatCents(expenseCents),
      profit: formatCents(incomeCents - expenseCents),
      auditCoveredRecordCount: selectedRecords.filter((record) => audited.has(record.id)).length,
      ledgerCoveredRecordCount: selectedRecords.filter((record) => ledgered.has(record.id)).length,
      exactDuplicateSourceGroups: [...sourceCounts.values()].filter((count) => count > 1).length,
      importTaskCount: selectedImports.length,
      importedRows: selectedImports.reduce((sum, task) => sum + task.importedRows, 0),
      ocrTaskCount: selectedOcr.length,
      ocrCorrectionCount: selectedOcr.reduce((sum, task) => sum + task.correctionCount, 0),
      ocrGeneratedRecordCount: selectedOcr.filter((task) => task.generatedRecordId !== null).length
    };
    const checks: Array<{ id: string; expected: string | number; actual: string | number; status: 'passed' | 'failed' }> = [];
    let expectedCheckCount = 0;
    for (const key of Object.keys(item.expected) as Array<keyof FinanceUatExpected>) {
      const expected = item.expected[key];
      if (expected === null) continue;
      expectedCheckCount += 1;
      checks.push({ id: key, expected, actual: actual[key], status: expected === actual[key] ? 'passed' : 'failed' });
    }
    addMissingCheck(checks, 'missingRecordIds', item.recordIds, records);
    addMissingCheck(checks, 'missingImportTaskIds', item.importTaskIds, importTasks);
    addMissingCheck(checks, 'missingOcrTaskIds', item.ocrTaskIds, ocrTasks);

    const failedChecks = checks.filter((check) => check.status === 'failed');
    const status = failedChecks.length > 0 ? 'failed' : expectedCheckCount > 0 ? 'passed' : 'awaiting_input';
    const hasOpenIssue = item.issueRefs.some((id) => ['open', 'in_progress'].includes(issues.get(id)?.status ?? ''));
    return {
      id: item.id,
      status,
      humanStatus: item.status,
      evidence: {
        requestedRecords: item.recordIds.length,
        requestedImportTasks: item.importTaskIds.length,
        requestedOcrTasks: item.ocrTaskIds.length,
        missingRecordTokens: missingTokens(item.recordIds, records),
        missingImportTaskTokens: missingTokens(item.importTaskIds, importTasks),
        missingOcrTaskTokens: missingTokens(item.ocrTaskIds, ocrTasks),
        recordStatuses: countByObject(selectedRecords, (record) => record.status),
        dataLayers: countByObject(selectedRecords, (record) => record.dataLayer),
        importStatuses: countByObject(selectedImports, (task) => task.status),
        ocrStatuses: countByObject(selectedOcr, (task) => task.status)
      },
      actual,
      checks,
      issueRefs: item.issueRefs,
      untrackedFailure: failedChecks.length > 0 && !hasOpenIssue
    };
  });

  const failed = cases.filter((item) => item.status === 'failed');
  const passed = cases.filter((item) => item.status === 'passed');
  const automaticStatus = failed.length > 0
    ? 'failed'
    : passed.length === FINANCE_UAT_SCENARIO_IDS.length
      ? 'passed'
      : passed.length > 0
        ? 'partial'
        : 'awaiting_input';

  return {
    schemaVersion: 'b8-08-report-v1',
    runId: manifest.runId,
    generatedAt: generatedAt.toISOString(),
    dataClassification: manifest.dataClassification,
    sourceFilesRead: false,
    automaticStatus,
    humanGateStatus: 'external_unverified',
    coverage: { passed: passed.length, failed: failed.length, awaitingInput: cases.length - passed.length - failed.length },
    unresolvedIssueCount: manifest.issues.filter((item) => item.status !== 'closed').length,
    untrackedFailures: cases.filter((item) => item.untrackedFailure).map((item) => item.id),
    signoffs: manifest.signoffs.map((item) => ({ role: item.role, status: item.status, approvalRef: item.approvalRef, decidedAt: item.decidedAt })),
    cases
  };
}

export function databaseFingerprint(databaseName: string): string {
  return createHash('sha256').update(databaseName).digest('hex').slice(0, 12);
}

function blankExpected(): FinanceUatExpected {
  return {
    recordCount: null,
    invalidRecordCount: null,
    income: null,
    expense: null,
    profit: null,
    auditCoveredRecordCount: null,
    ledgerCoveredRecordCount: null,
    exactDuplicateSourceGroups: null,
    importTaskCount: null,
    importedRows: null,
    ocrTaskCount: null,
    ocrCorrectionCount: null,
    ocrGeneratedRecordCount: null
  };
}

function parseMoneyToCents(value: string): bigint {
  const match = /^(-?)(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (!match) throw new Error(`Invalid fixed-2 money value: ${value}`);
  const cents = BigInt(match[2]) * 100n + BigInt(match[3]);
  return match[1] ? -cents : cents;
}

function sumMoney(values: string[]): bigint {
  return values.reduce((sum, value) => sum + parseMoneyToCents(value), 0n);
}

function formatCents(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function addMissingCheck<T>(
  checks: Array<{ id: string; expected: string | number; actual: string | number; status: 'passed' | 'failed' }>,
  id: string,
  requested: string[],
  available: Map<string, T>
) {
  if (requested.length === 0) return;
  const missing = requested.filter((value) => !available.has(value)).length;
  checks.push({ id, expected: 0, actual: missing, status: missing === 0 ? 'passed' : 'failed' });
}

function missingTokens<T>(requested: string[], available: Map<string, T>): string[] {
  return requested.filter((id) => !available.has(id)).map((id) => evidenceToken(id));
}

function evidenceToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function countByObject<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return Object.fromEntries([...countBy(items, key).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`B8-08 UAT manifest contains duplicate ${label}.`);
}

function assertExactSet(actual: readonly string[], expected: readonly string[], label: string) {
  if (actual.length !== expected.length || expected.some((value) => !actual.includes(value))) {
    throw new Error(`B8-08 UAT manifest must contain exactly these ${label}: ${expected.join(', ')}.`);
  }
  assertUnique([...actual], label);
}
