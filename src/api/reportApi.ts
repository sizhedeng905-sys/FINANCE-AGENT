import { mockAnomalies, mockBossReports, mockFinanceReport } from '@/mock/mockReports';
import type { BossReport } from '@/types/report';

const delay = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));

// GET /api/reports/finance?period=today
export async function fetchFinanceReportApi() {
  await delay();
  return mockFinanceReport;
}

// GET /api/reports/finance?period=:period
export async function fetchFinanceReportByPeriodApi(period: 'today' | 'week' | 'month') {
  await delay();
  const ratioMap = { today: 1, week: 5, month: 22 };
  const ratio = ratioMap[period];
  return {
    ...mockFinanceReport,
    id: `${mockFinanceReport.id}-${period}`,
    newWorkOrders: mockFinanceReport.newWorkOrders * ratio,
    approvedCount: mockFinanceReport.approvedCount * ratio,
    rejectedCount: mockFinanceReport.rejectedCount * ratio,
    totalIncome: mockFinanceReport.totalIncome * ratio,
    totalExpense: mockFinanceReport.totalExpense * ratio,
    estimatedProfit: mockFinanceReport.estimatedProfit * ratio,
  };
}

// GET /api/reports/boss
export async function fetchBossReportsApi() {
  await delay();
  return mockBossReports;
}

// GET /api/reports/boss?period=:period
export async function fetchBossReportByPeriodApi(
  period: BossReport['period'],
): Promise<BossReport | undefined> {
  await delay();
  return mockBossReports.find((item) => item.period === period);
}

// GET /api/reports/anomalies
export async function fetchAIAnomaliesApi() {
  await delay();
  return mockAnomalies;
}
