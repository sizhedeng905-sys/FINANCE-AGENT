import { create } from 'zustand';
import { mockBossReports, mockFinanceReport } from '@/mock/mockReports';

interface ReportState {
  financeReport: typeof mockFinanceReport;
  bossReports: typeof mockBossReports;
}

export const useReportStore = create<ReportState>(() => ({
  financeReport: mockFinanceReport,
  bossReports: mockBossReports,
}));
