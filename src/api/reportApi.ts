import { runtimeConfig } from '@/config/runtime';
import type {
  BossReport,
  BossReportPeriod,
  FinanceReport,
  FinanceReportPeriod,
  ProjectReport,
  ReportNarrativeGenerationResult,
  ReportSnapshotResult,
  ReportSnapshotType,
} from '@/types/report';
import { httpClient } from './httpClient';
import {
  mockFetchBossReport,
  mockFetchFinanceReport,
  mockFetchProjectDailyReport,
  mockFetchProjectMonthlyReport,
  mockCreateReportSnapshot,
  mockGenerateReportNarrative,
} from './mockReportRepository';

function reportQuery(periodKey: string, period: string, dateKey?: string, date?: string): string {
  const params = new URLSearchParams({ [periodKey]: period });
  if (dateKey && date) params.set(dateKey, date);
  return `?${params.toString()}`;
}

export function fetchFinanceReportApi(
  period: FinanceReportPeriod = 'today',
  date?: string,
): Promise<FinanceReport> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<FinanceReport>(`/reports/finance${reportQuery('period', period, 'date', date)}`)
    : mockFetchFinanceReport(period);
}

export const fetchFinanceReportByPeriodApi = fetchFinanceReportApi;

export function fetchBossReportByPeriodApi(
  period: BossReportPeriod,
  date?: string,
): Promise<BossReport> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<BossReport>(`/reports/boss${reportQuery('period', period, 'date', date)}`)
    : mockFetchBossReport(period);
}

export function fetchBossReportsApi(): Promise<BossReport[]> {
  return Promise.all(
    (['daily', 'weekly', 'monthly'] as BossReportPeriod[]).map((period) => fetchBossReportByPeriodApi(period)),
  );
}

export function fetchProjectDailyReportApi(projectId: string, date?: string): Promise<ProjectReport> {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<ProjectReport>(`/reports/projects/${encodeURIComponent(projectId)}/daily${query}`)
    : mockFetchProjectDailyReport(projectId, date);
}

export function fetchProjectMonthlyReportApi(projectId: string, month?: string): Promise<ProjectReport> {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<ProjectReport>(`/reports/projects/${encodeURIComponent(projectId)}/monthly${query}`)
    : mockFetchProjectMonthlyReport(projectId, month);
}

const snapshotTypeByPeriod: Record<BossReportPeriod, ReportSnapshotType> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
};

export function createReportSnapshotApi(
  period: BossReportPeriod,
  date?: string,
  projectIds?: string[],
): Promise<ReportSnapshotResult> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ReportSnapshotResult>('/reports/snapshots', {
      reportType: snapshotTypeByPeriod[period],
      ...(date ? { date } : {}),
      ...(projectIds?.length ? { projectIds } : {}),
    })
    : mockCreateReportSnapshot(period);
}

export function generateReportNarrativeApi(snapshotId: string): Promise<ReportNarrativeGenerationResult> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ReportNarrativeGenerationResult>(
      `/ai/report-snapshots/${encodeURIComponent(snapshotId)}/narrative`,
      {},
    )
    : mockGenerateReportNarrative(snapshotId);
}
