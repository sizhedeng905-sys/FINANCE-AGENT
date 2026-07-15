import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AnomalyStatus,
  BusinessRecordStatus,
  Prisma,
  RecordDataLayer,
  RiskLevel,
  WorkOrderStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { QueryBossReportDto, QueryDailyReportDto, QueryFinanceReportDto, QueryMonthlyReportDto } from './dto/query-reports.dto';
import { dayRange, formatChinaDate, monthRange, reportRange, shiftMonthDate } from './report-period';

type RecordWithProject = Prisma.BusinessRecordGetPayload<{ include: { project: true } }>;
type AnomalyWithWorkOrder = Prisma.AiAnomalyGetPayload<{ include: { workOrder: true } }>;
type ReportRange = ReturnType<typeof reportRange>;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async finance(dto: QueryFinanceReportDto) {
    const period = dto.period ?? 'today';
    const range = reportRange(period, dto.date);
    const anomalyWhere: Prisma.AiAnomalyWhereInput = {
      status: { in: [AnomalyStatus.open, AnomalyStatus.acknowledged] },
      detectedAt: { gte: range.start, lt: range.end }
    };
    const [
      newWorkOrders,
      approvedCount,
      rejectedCount,
      supplementCount,
      pendingFinanceReview,
      records,
      newRecords,
      confirmedRecords,
      anomalyCount,
      anomalies
    ] = await Promise.all([
      this.prisma.workOrder.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
      this.prisma.approval.count({
        where: { approverRole: 'finance', action: 'approve', createdAt: { gte: range.start, lt: range.end } }
      }),
      this.prisma.approval.count({
        where: { approverRole: 'finance', action: 'reject', createdAt: { gte: range.start, lt: range.end } }
      }),
      this.prisma.approval.count({
        where: { approverRole: 'finance', action: 'supplement', createdAt: { gte: range.start, lt: range.end } }
      }),
      this.prisma.workOrder.count({
        where: { status: { in: [WorkOrderStatus.finance_reviewing, WorkOrderStatus.reviewer_rejected] } }
      }),
      this.findRecords(range.start, range.end),
      this.prisma.businessRecord.count({
        where: { dataLayer: RecordDataLayer.actual, createdAt: { gte: range.start, lt: range.end } }
      }),
      this.prisma.businessRecord.count({
        where: {
          dataLayer: RecordDataLayer.actual,
          status: BusinessRecordStatus.confirmed,
          confirmedAt: { gte: range.start, lt: range.end }
        }
      }),
      this.prisma.aiAnomaly.count({ where: anomalyWhere }),
      this.prisma.aiAnomaly.findMany({
        where: anomalyWhere,
        orderBy: [{ riskLevel: 'desc' }, { detectedAt: 'desc' }],
        take: 20,
        include: { workOrder: true }
      })
    ]);
    const totals = this.totals(records);
    return {
      id: `finance-${period}-${range.label}`,
      date: range.label,
      period,
      range: this.rangeMetadata(range),
      generatedAt: new Date().toISOString(),
      newWorkOrders,
      approvedCount,
      rejectedCount,
      supplementCount,
      reviewedCount: approvedCount + rejectedCount + supplementCount,
      pendingFinanceReview,
      newRecords,
      confirmedRecords,
      recordCount: records.length,
      anomalyCount,
      totalIncome: totals.income,
      totalExpense: totals.expense,
      estimatedProfit: totals.profit,
      expenseCategories: this.expenseCategories(records),
      anomalies: anomalies.map((item) => this.presentAnomaly(item)),
      aiSummary: anomalyCount
        ? `本周期发现${anomalyCount}项未处理规则异常，需要财务优先核对。`
        : '本周期规则复核未发现未处理异常。'
    };
  }

  async boss(dto: QueryBossReportDto) {
    const periodMap = { daily: 'today', weekly: 'week', monthly: 'month' } as const;
    const period = dto.period ?? 'daily';
    const range = reportRange(periodMap[period], dto.date);
    const anomalyWhere: Prisma.AiAnomalyWhereInput = {
      status: { in: [AnomalyStatus.open, AnomalyStatus.acknowledged] },
      detectedAt: { gte: range.start, lt: range.end }
    };
    const [
      records,
      pendingApprovals,
      highRiskPending,
      approvedCount,
      rejectedCount,
      anomalyCount,
      anomalies
    ] = await Promise.all([
      this.findRecords(range.start, range.end),
      this.prisma.workOrder.count({ where: { status: WorkOrderStatus.boss_pending } }),
      this.prisma.workOrder.count({
        where: { status: WorkOrderStatus.boss_pending, riskLevel: RiskLevel.high }
      }),
      this.prisma.approval.count({
        where: { approverRole: 'boss', action: 'approve', createdAt: { gte: range.start, lt: range.end } }
      }),
      this.prisma.approval.count({
        where: { approverRole: 'boss', action: 'reject', createdAt: { gte: range.start, lt: range.end } }
      }),
      this.prisma.aiAnomaly.count({ where: anomalyWhere }),
      this.prisma.aiAnomaly.findMany({
        where: anomalyWhere,
        orderBy: [{ riskLevel: 'desc' }, { detectedAt: 'desc' }],
        take: 20,
        include: { workOrder: true }
      })
    ]);
    const totals = this.totals(records);
    const suggestions = anomalyCount
      ? ['优先处理高风险异常工单', '复核异常项目的收入与成本凭证']
      : ['暂无未处理异常，按正常审批节奏推进'];
    return {
      id: `boss-${period}-${range.label}`,
      period,
      title: period === 'daily' ? '经营日报' : period === 'weekly' ? '经营周报' : '经营月报',
      date: range.label,
      range: this.rangeMetadata(range),
      generatedAt: new Date().toISOString(),
      income: totals.income,
      expense: totals.expense,
      profit: totals.profit,
      profitRate: this.profitRate(totals.income, totals.profit),
      recordCount: records.length,
      anomalies: anomalies.map((item) => `${item.workOrder.orderNo}：${item.reason}`),
      highRiskItems: anomalies.map((item) => this.presentAnomaly(item)),
      anomalyCount,
      pendingApprovals,
      highRiskPending,
      approvedCount,
      rejectedCount,
      projectRanking: this.projectRanking(records, anomalies),
      expenseCategories: this.expenseCategories(records),
      aiSummary: `本周期确认收入${totals.income}元，确认支出${totals.expense}元，利润${totals.profit}元。`,
      aiSuggestion: suggestions.join('；'),
      aiSuggestions: suggestions
    };
  }

  async projectDaily(projectId: string, dto: QueryDailyReportDto) {
    const project = await this.findProject(projectId);
    const range = dayRange(dto.date);
    const [records, anomalyCount] = await Promise.all([
      this.findRecords(range.start, range.end, projectId),
      this.prisma.aiAnomaly.count({
        where: { projectId, status: AnomalyStatus.open, detectedAt: { gte: range.start, lt: range.end } }
      })
    ]);
    const totals = this.totals(records);
    const categories = this.expenseCategories(records);
    return {
      project: { id: project.id, name: project.name },
      projectId: project.id,
      projectName: project.name,
      date: range.label,
      range: this.rangeMetadata(range),
      generatedAt: new Date().toISOString(),
      ...totals,
      cost: totals.expense,
      recordCount: records.length,
      recordsCount: records.length,
      anomalyCount,
      expenseCategories: categories,
      categoryBreakdown: categories.map((item) => ({ category: item.name, amount: item.amount }))
    };
  }

  async projectMonthly(projectId: string, dto: QueryMonthlyReportDto) {
    const project = await this.findProject(projectId);
    const range = monthRange(dto.month);
    const [records, anomalyCount] = await Promise.all([
      this.findRecords(range.start, range.end, projectId),
      this.prisma.aiAnomaly.count({
        where: { projectId, status: AnomalyStatus.open, detectedAt: { gte: range.start, lt: range.end } }
      })
    ]);
    const days = new Map<string, RecordWithProject[]>();
    for (const record of records) {
      const date = formatChinaDate(record.recordDate);
      days.set(date, [...(days.get(date) ?? []), record]);
    }
    const totals = this.totals(records);
    return {
      project: { id: project.id, name: project.name },
      projectId: project.id,
      projectName: project.name,
      month: range.label,
      range: this.rangeMetadata(range),
      generatedAt: new Date().toISOString(),
      ...totals,
      cost: totals.expense,
      recordCount: records.length,
      recordsCount: records.length,
      anomalyCount,
      expenseCategories: this.expenseCategories(records),
      dailyTrend: Array.from(days.entries())
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([date, dayRecords]) => ({ date, ...this.totals(dayRecords) }))
    };
  }

  async projectSummary(projectId: string) {
    const project = await this.findProject(projectId);
    const records = await this.prisma.businessRecord.findMany({
      where: { projectId, dataLayer: RecordDataLayer.actual, status: BusinessRecordStatus.confirmed },
      include: { project: true }
    });
    return {
      project: { id: project.id, name: project.name, customerName: project.customerName },
      ...this.totals(records),
      recordCount: records.length
    };
  }

  async projectPeriodSummary(
    projectId: string,
    period: 'today' | 'week' | 'month',
    date?: string
  ) {
    const project = await this.findProject(projectId);
    const range = reportRange(period, date);
    const records = await this.findRecords(range.start, range.end, projectId);
    return {
      project: { id: project.id, name: project.name, customerName: project.customerName },
      period,
      range: this.rangeMetadata(range),
      ...this.totals(records),
      recordCount: records.length,
      expenseCategories: this.expenseCategories(records)
    };
  }

  async bossComparison(kind: 'month_over_month' | 'year_over_year', date?: string) {
    const current = await this.boss({ period: 'monthly', date });
    const baselineDate = shiftMonthDate(current.range.startDate, kind === 'month_over_month' ? -1 : -12);
    const baseline = await this.boss({ period: 'monthly', date: baselineDate });
    return {
      kind,
      label: kind === 'month_over_month' ? '月环比' : '月同比',
      current: this.comparisonSnapshot(current),
      baseline: this.comparisonSnapshot(baseline),
      changes: {
        income: this.comparisonChange(current.income, baseline.income),
        expense: this.comparisonChange(current.expense, baseline.expense),
        profit: this.comparisonChange(current.profit, baseline.profit)
      }
    };
  }

  async projectComparison(
    projectId: string,
    kind: 'month_over_month' | 'year_over_year',
    month?: string
  ) {
    const current = await this.projectMonthly(projectId, { month });
    const baselineMonth = shiftMonthDate(`${current.month}-01`, kind === 'month_over_month' ? -1 : -12).slice(0, 7);
    const baseline = await this.projectMonthly(projectId, { month: baselineMonth });
    return {
      kind,
      label: kind === 'month_over_month' ? '月环比' : '月同比',
      project: current.project,
      current: this.comparisonSnapshot(current),
      baseline: this.comparisonSnapshot(baseline),
      changes: {
        income: this.comparisonChange(current.income, baseline.income),
        expense: this.comparisonChange(current.expense, baseline.expense),
        profit: this.comparisonChange(current.profit, baseline.profit)
      }
    };
  }

  async pendingApprovals() {
    const items = await this.prisma.workOrder.findMany({
      where: { status: WorkOrderStatus.boss_pending },
      orderBy: [{ urgent: 'desc' }, { createdAt: 'asc' }],
      take: 100
    });
    return items.map((item) => ({
      id: item.id,
      orderNo: item.orderNo,
      projectId: item.projectId,
      projectName: item.projectName,
      amount: item.amount.toFixed(2),
      riskLevel: item.riskLevel,
      urgent: item.urgent
    }));
  }

  private findRecords(start: Date, end: Date, projectId?: string) {
    return this.prisma.businessRecord.findMany({
      where: {
        projectId,
        dataLayer: RecordDataLayer.actual,
        status: BusinessRecordStatus.confirmed,
        recordDate: { gte: start, lt: end }
      },
      include: { project: true },
      orderBy: { recordDate: 'asc' }
    });
  }

  private totals(records: RecordWithProject[]) {
    let income = new Prisma.Decimal(0);
    let expense = new Prisma.Decimal(0);
    for (const record of records) {
      if (this.isIncome(record)) income = income.plus(record.amount);
      else expense = expense.plus(record.amount);
    }
    return {
      income: this.toMoney(income),
      expense: this.toMoney(expense),
      profit: this.toMoney(income.minus(expense))
    };
  }

  private comparisonSnapshot(report: {
    range: { startDate: string; endDate: string; timezone: string };
    income: string;
    expense: string;
    profit: string;
    recordCount: number;
  }) {
    return {
      range: report.range,
      income: report.income,
      expense: report.expense,
      profit: report.profit,
      recordCount: report.recordCount
    };
  }

  private comparisonChange(currentValue: string, baselineValue: string) {
    const current = new Prisma.Decimal(currentValue);
    const baseline = new Prisma.Decimal(baselineValue);
    return {
      delta: this.toMoney(current.minus(baseline)),
      rate: baseline.isZero()
        ? null
        : current.minus(baseline).dividedBy(baseline.abs()).toDecimalPlaces(4).toString()
    };
  }

  private expenseCategories(records: RecordWithProject[]) {
    const categories = new Map<string, { amount: Prisma.Decimal; recordCount: number }>();
    for (const record of records.filter((item) => !this.isIncome(item))) {
      const name = record.subCategory || record.category || '未分类';
      const current = categories.get(name) ?? { amount: new Prisma.Decimal(0), recordCount: 0 };
      categories.set(name, {
        amount: current.amount.plus(record.amount),
        recordCount: current.recordCount + 1
      });
    }
    const totalExpense = Array.from(categories.values()).reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0)
    );
    return Array.from(categories.entries())
      .sort((first, second) => second[1].amount.comparedTo(first[1].amount) || first[0].localeCompare(second[0]))
      .map(([name, item]) => ({
        name,
        amount: this.toMoney(item.amount),
        recordCount: item.recordCount,
        percentage: totalExpense.isZero() ? 0 : item.amount.dividedBy(totalExpense).toDecimalPlaces(4).toNumber()
      }));
  }

  private projectRanking(records: RecordWithProject[], anomalies: AnomalyWithWorkOrder[]) {
    const groups = new Map<string, RecordWithProject[]>();
    const riskCounts = new Map<string, number>();
    for (const record of records) groups.set(record.projectId, [...(groups.get(record.projectId) ?? []), record]);
    for (const anomaly of anomalies) {
      if (anomaly.projectId) riskCounts.set(anomaly.projectId, (riskCounts.get(anomaly.projectId) ?? 0) + 1);
    }
    return Array.from(groups.entries())
      .map(([projectId, projectRecords]) => {
        const totals = this.totals(projectRecords);
        return {
          projectId,
          projectName: projectRecords[0].project.name,
          ...totals,
          cost: totals.expense,
          profitRate: this.profitRate(totals.income, totals.profit),
          riskCount: riskCounts.get(projectId) ?? 0
        };
      })
      .sort(
        (first, second) =>
          new Prisma.Decimal(second.profit).comparedTo(first.profit) ||
          first.projectName.localeCompare(second.projectName)
      );
  }

  private presentAnomaly(item: AnomalyWithWorkOrder) {
    return {
      id: item.id,
      workOrderId: item.workOrderId,
      orderNo: item.workOrder.orderNo,
      projectId: item.projectId,
      projectName: item.workOrder.projectName,
      riskLevel: item.riskLevel,
      reason: item.reason,
      suggestion: item.suggestion,
      status: item.status,
      detectedAt: item.detectedAt
    };
  }

  private rangeMetadata(range: ReportRange) {
    return { startDate: range.startDate, endDate: range.endDate, timezone: 'Asia/Shanghai' };
  }

  private toMoney(value: Prisma.Decimal) {
    return value.toFixed(2);
  }

  private isIncome(record: RecordWithProject) {
    return record.accountingDirection === 'income';
  }

  private profitRate(income: string, profit: string) {
    const incomeDecimal = new Prisma.Decimal(income);
    return incomeDecimal.isZero()
      ? 0
      : new Prisma.Decimal(profit).dividedBy(incomeDecimal).toDecimalPlaces(4).toNumber();
  }

  private async findProject(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('资源不存在');
    return project;
  }
}
