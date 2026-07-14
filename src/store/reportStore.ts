import { create } from 'zustand';
import { fetchBossReportByPeriodApi, fetchBossReportsApi, fetchFinanceReportApi } from '@/api/reportApi';
import type { BossReport, BossReportPeriod, FinanceReport, FinanceReportPeriod } from '@/types/report';

interface ReportState {
  financeReports: Partial<Record<FinanceReportPeriod, FinanceReport>>;
  bossReports: BossReport[];
  financeLoading: boolean;
  bossLoading: boolean;
  financeError: string | null;
  bossError: string | null;
  fetchFinanceReport: (period: FinanceReportPeriod, date?: string) => Promise<FinanceReport>;
  fetchBossReport: (period: BossReportPeriod, date?: string) => Promise<BossReport>;
  fetchBossReports: () => Promise<BossReport[]>;
  resetReports: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '报表请求失败';
}

function upsertBoss(items: BossReport[], report: BossReport): BossReport[] {
  return [...items.filter((item) => item.period !== report.period), report];
}

export const useReportStore = create<ReportState>((set) => ({
  financeReports: {},
  bossReports: [],
  financeLoading: false,
  bossLoading: false,
  financeError: null,
  bossError: null,
  fetchFinanceReport: async (period, date) => {
    set({ financeLoading: true, financeError: null });
    try {
      const report = await fetchFinanceReportApi(period, date);
      set((state) => ({
        financeReports: { ...state.financeReports, [period]: report },
        financeLoading: false,
      }));
      return report;
    } catch (error) {
      set({ financeLoading: false, financeError: message(error) });
      throw error;
    }
  },
  fetchBossReport: async (period, date) => {
    set({ bossLoading: true, bossError: null });
    try {
      const report = await fetchBossReportByPeriodApi(period, date);
      set((state) => ({ bossReports: upsertBoss(state.bossReports, report), bossLoading: false }));
      return report;
    } catch (error) {
      set({ bossLoading: false, bossError: message(error) });
      throw error;
    }
  },
  fetchBossReports: async () => {
    set({ bossLoading: true, bossError: null });
    try {
      const reports = await fetchBossReportsApi();
      set({ bossReports: reports, bossLoading: false });
      return reports;
    } catch (error) {
      set({ bossLoading: false, bossError: message(error) });
      throw error;
    }
  },
  resetReports: () => set({
    financeReports: {},
    bossReports: [],
    financeLoading: false,
    bossLoading: false,
    financeError: null,
    bossError: null,
  }),
}));
