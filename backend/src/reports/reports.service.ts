import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AnomalyStatus,
  BusinessRecordStatus,
  DataRecordType,
  Prisma,
  RiskLevel,
  WorkOrderStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { QueryBossReportDto, QueryDailyReportDto, QueryFinanceReportDto, QueryMonthlyReportDto } from './dto/query-reports.dto';
import { dayRange, formatChinaDate, monthRange, reportRange } from './report-period';

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
      status: AnomalyStatus.open,
      detectedAt: { gte: range.start, lt: range.end }
    };
    const [
      newWorkOrders,
      approvedCount,
      rejectedCount,
      supplementCount,
      pendingFinanceReview,
      records,
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
      newRecords: records.length,
      confirmedRecords: records.length,
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
      status: AnomalyStatus.open,
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
      profitRate: totals.income === 0 ? 0 : Number((totals.profit / totals.income).toFixed(4)),
      recordCount: records.length,
      anomalies: anomalies.map((item) => `${item.workOrder.orderNo}：${item.reason}`),
      highRiskItems: anomalies.map((item) => this.presentAnomaly(item)),
      anomalyCount,
      pendingApprovals,
      highRiskPending,
      approvedCount,
      rejectedCount,
      projectRanking: this.projectRanking(records, anomalies),
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
      where: { projectId, status: BusinessRecordStatus.confirmed },
      include: { project: true }
    });
    return {
      project: { id: project.id, name: project.name, customerName: project.customerName },
      ...this.totals(records),
      recordCount: records.length
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
      amount: Number(item.amount),
      riskLevel: item.riskLevel,
      urgent: item.urgent
    }));
  }

  private findRecords(start: Date, end: Date, projectId?: string) {
    return this.prisma.businessRecord.findMany({
      where: {
        projectId,
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
    const normalizedIncome = this.toMoney(income);
    const normalizedExpense = this.toMoney(expense);
    return {
      income: normalizedIncome,
      expense: normalizedExpense,
      profit: this.toMoney(income.minus(expense))
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
      .map(([name, item]) => ({
        name,
        amount: this.toMoney(item.amount),
        recordCount: item.recordCount,
        percentage: totalExpense.isZero() ? 0 : item.amount.dividedBy(totalExpense).toDecimalPlaces(4).toNumber()
      }))
      .sort((first, second) => second.amount - first.amount || first.name.localeCompare(second.name));
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
          profitRate: totals.income === 0 ? 0 : Number((totals.profit / totals.income).toFixed(4)),
          riskCount: riskCounts.get(projectId) ?? 0
        };
      })
      .sort((first, second) => second.profit - first.profit || first.projectName.localeCompare(second.projectName));
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
    return value.toDecimalPlaces(2).toNumber();
  }

  private isIncome(record: RecordWithProject) {
    return record.recordType === DataRecordType.revenue || record.category === '收入';
  }

  private async findProject(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('资源不存在');
    return project;
  }
}
