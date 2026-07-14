import { mockBossReports, mockFinanceReports } from '@/mock/mockReports';
import type { BusinessRecord } from '@/types/dataCenter';
import type { BossReport, BossReportPeriod, FinanceReport, FinanceReportPeriod, ProjectReport } from '@/types/report';
import { mockGetProject } from './mockProjectRepository';
import { mockRecordSnapshot } from './mockRecordRepository';

const delay = (ms = 140) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
  return record.recordType === 'revenue' || record.category === '收入';
}

function totals(records: BusinessRecord[]) {
  const income = records.filter(isIncome).reduce((sum, item) => sum + item.amount, 0);
  const expense = records.filter((item) => !isIncome(item)).reduce((sum, item) => sum + item.amount, 0);
  return { income, expense, cost: expense, profit: income - expense };
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
    return item.projectId === projectId && item.status === 'confirmed' && date >= start && date <= end;
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
