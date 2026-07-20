import { mockBossReports, mockFinanceReports } from '@/mock/mockReports';
import type { BusinessRecord } from '@/types/dataCenter';
import type {
  BossReport,
  BossReportPeriod,
  FinanceReport,
  FinanceReportPeriod,
  ProjectReport,
  ReportNarrativeGenerationResult,
  ReportSnapshot,
  ReportSnapshotResult,
} from '@/types/report';
import { mockGetProject } from './mockProjectRepository';
import { mockRecordSnapshot } from './mockRecordRepository';
import { subtractMoney, sumMoney } from '@/utils/money';

const delay = (ms = 140) => new Promise((resolve) => window.setTimeout(resolve, ms));
const reportSnapshots = new Map<string, ReportSnapshot>();

function mockHash(value: unknown) {
  const source = JSON.stringify(value);
  return Array.from(source).reduce((hash, character) => ((hash * 31 + character.charCodeAt(0)) >>> 0), 0)
    .toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function cloneFinance(report: FinanceReport): FinanceReport {
  return {
    ...report,
    range: { ...report.range },
    expenseCategories: report.expenseCategories.map((item) => ({ ...item })),
    anomalies: report.anomalies.map((item) => ({ ...item })),
  };
}

function cloneBoss(report: BossReport): BossReport {
  return {
    ...report,
    range: { ...report.range },
    anomalies: [...report.anomalies],
    highRiskItems: report.highRiskItems.map((item) => ({ ...item })),
    projectRanking: report.projectRanking.map((item) => ({ ...item })),
    aiSuggestions: [...report.aiSuggestions],
  };
}

function isIncome(record: BusinessRecord): boolean {
  return record.accountingDirection === 'income';
}

function totals(records: BusinessRecord[]) {
  const income = sumMoney(records.filter(isIncome).map((item) => item.amount));
  const expense = sumMoney(records.filter((item) => !isIncome(item)).map((item) => item.amount));
  return { income, expense, cost: expense, profit: subtractMoney(income, expense) };
}

function monthBounds(month?: string) {
  const value = month ?? '2026-07';
  const [year, monthNumber] = value.split('-').map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const end = `${year}-${String(monthNumber).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  return { value, start, end };
}

function projectRecords(projectId: string, start: string, end: string) {
  return mockRecordSnapshot().filter((item) => {
    const date = item.recordDate.slice(0, 10);
    return item.projectId === projectId
      && item.dataLayer === 'actual'
      && item.status === 'confirmed'
      && date >= start
      && date <= end;
  });
}

export async function mockFetchFinanceReport(period: FinanceReportPeriod): Promise<FinanceReport> {
  await delay();
  return cloneFinance(mockFinanceReports[period]);
}

export async function mockFetchBossReport(period: BossReportPeriod): Promise<BossReport> {
  await delay();
  const report = mockBossReports.find((item) => item.period === period);
  if (!report) throw new Error('报表不存在');
  return cloneBoss(report);
}

export async function mockFetchProjectDailyReport(projectId: string, date = '2026-07-11'): Promise<ProjectReport> {
  await delay();
  const project = await mockGetProject(projectId);
  const records = projectRecords(projectId, date, date);
  const amounts = totals(records);
  return {
    project: { id: project.id, name: project.name },
    projectId: project.id,
    projectName: project.name,
    date,
    range: { startDate: date, endDate: date, timezone: 'Asia/Shanghai' },
    generatedAt: new Date().toISOString(),
    ...amounts,
    recordCount: records.length,
    recordsCount: records.length,
    anomalyCount: 0,
    expenseCategories: [],
  };
}

export async function mockFetchProjectMonthlyReport(projectId: string, month?: string): Promise<ProjectReport> {
  await delay();
  const project = await mockGetProject(projectId);
  const bounds = monthBounds(month);
  const records = projectRecords(projectId, bounds.start, bounds.end);
  const amounts = totals(records);
  return {
    project: { id: project.id, name: project.name },
    projectId: project.id,
    projectName: project.name,
    month: bounds.value,
    range: { startDate: bounds.start, endDate: bounds.end, timezone: 'Asia/Shanghai' },
    generatedAt: new Date().toISOString(),
    ...amounts,
    recordCount: records.length,
    recordsCount: records.length,
    anomalyCount: 0,
    expenseCategories: [],
    dailyTrend: [],
  };
}

export async function mockCreateReportSnapshot(period: BossReportPeriod): Promise<ReportSnapshotResult> {
  await delay();
  const report = await mockFetchBossReport(period);
  const snapshotId = `mock-report-snapshot-${period}`;
  const facts = {
    reportType: period === 'weekly' ? 'WEEKLY' as const : period === 'monthly' ? 'MONTHLY' as const : 'DAILY' as const,
    period: {
      start: report.range.startDate,
      endExclusive: nextDate(report.range.endDate),
      timezone: 'Asia/Shanghai' as const,
    },
    metrics: {
      currency: 'CNY',
      income: report.income,
      cost: report.expense,
      profit: report.profit,
      recordCount: report.recordCount,
      byCurrency: [{
        currency: 'CNY',
        income: report.income,
        cost: report.expense,
        profit: report.profit,
        recordCount: report.recordCount,
      }],
    },
  };
  const sourceDigest = mockHash({ period, recordCount: report.recordCount, mock: true });
  const snapshotHash = mockHash({ ...facts, sourceDigest, queryVersion: 'confirmed-actual-report/1.0' });
  const existing = reportSnapshots.get(snapshotId);
  if (existing?.snapshotHash === snapshotHash) return { snapshot: existing, reused: true, sourceCount: report.recordCount };
  const snapshot: ReportSnapshot = {
    schemaVersion: 'report-snapshot/1.0',
    snapshotId,
    ...facts,
    scope: { organizationId: 'default', scopeType: 'COMPANY', projectIds: [] },
    dataPolicy: {
      recordStatus: 'CONFIRMED',
      dataLayer: 'ACTUAL',
      currencies: ['CNY'],
      currencyAggregation: 'SEPARATE_BY_CURRENCY',
    },
    breakdowns: [],
    warnings: [{
      code: 'MOCK_AND_FORMAL_POLICY_PENDING',
      message: '当前为显式 Mock 快照，正式经营指标口径和真实逐分对账仍待人工签字。',
    }],
    queryVersion: 'confirmed-actual-report/1.0',
    dataWatermark: `mock:${sourceDigest}`,
    sourceDigest,
    canonicalizationVersion: 'report-c14n/1.0',
    snapshotHash,
    generatedAt: new Date().toISOString(),
    retentionClass: 'REPORT_AUDIT_PENDING_H14',
  };
  reportSnapshots.set(snapshotId, snapshot);
  return { snapshot, reused: false, sourceCount: report.recordCount };
}

export async function mockGenerateReportNarrative(snapshotId: string): Promise<ReportNarrativeGenerationResult> {
  await delay();
  const snapshot = reportSnapshots.get(snapshotId);
  if (!snapshot) throw new Error('请先生成报告快照');
  const countText = `本期确认记录共 ${snapshot.metrics.recordCount} 条。`;
  const claims = [
    {
      claimId: 'record-count',
      claimType: 'COUNT' as const,
      text: countText,
      sourcePath: '/metrics/recordCount',
      value: String(snapshot.metrics.recordCount),
      sourceValueHash: mockHash({ sourcePath: '/metrics/recordCount', value: String(snapshot.metrics.recordCount) }),
    },
    ...snapshot.warnings.map((warning, index) => ({
      claimId: `warning-${index + 1}`,
      claimType: 'WARNING' as const,
      text: warning.message,
      sourcePath: `/warnings/${index}/message`,
      value: warning.message,
      sourceValueHash: mockHash({ sourcePath: `/warnings/${index}/message`, value: warning.message }),
    })),
  ];
  return {
    status: 'needs_finance_review',
    narrative: {
      id: `mock-narrative-${snapshotId}`,
      snapshotId,
      snapshotHash: snapshot.snapshotHash,
      schemaVersion: 'report-narrative/1.0',
      title: snapshot.reportType === 'WEEKLY' ? '经营周报' : snapshot.reportType === 'MONTHLY' ? '经营月报' : '经营日报',
      summary: countText,
      warningPaths: snapshot.warnings.map((_warning, index) => `/warnings/${index}`),
      decision: 'NEEDS_FINANCE_REVIEW',
      narrativeHash: mockHash(claims),
      provider: 'mock',
      model: 'mock-structured-v1',
      promptVersion: 'report_narrative:v3',
      versionVectorHash: mockHash({ snapshotHash: snapshot.snapshotHash, prompt: 'v3' }),
      aiTaskId: `mock-task-${snapshotId}`,
      claims,
      createdAt: new Date().toISOString(),
    },
  };
}
