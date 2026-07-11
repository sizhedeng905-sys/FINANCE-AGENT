import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AnomalyStatus,
  BusinessRecordStatus,
  DataRecordType,
  Prisma,
  WorkOrderStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { QueryBossReportDto, QueryDailyReportDto, QueryFinanceReportDto, QueryMonthlyReportDto } from './dto/query-reports.dto';
import { dayRange, formatChinaDate, monthRange, reportRange, ReportPeriod } from './report-period';

type RecordWithProject = Prisma.BusinessRecordGetPayload<{ include: { project: true } }>;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async finance(dto: QueryFinanceReportDto) {
    const period = dto.period ?? 'today';
    const range = reportRange(period);
    const [newWorkOrders, approvedCount, rejectedCount, records, anomalyCount] = await Promise.all([
      this.prisma.workOrder.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
      this.prisma.approval.count({ where: { approverRole: 'finance', action: 'approve', createdAt: { gte: range.start, lt: range.end } } }),
      this.prisma.approval.count({ where: { action: { in: ['reject', 'reject_to_finance', 'supplement'] }, createdAt: { gte: range.start, lt: range.end } } }),
      this.findRecords(range.start, range.end),
      this.prisma.aiAnomaly.count({ where: { status: AnomalyStatus.open, detectedAt: { gte: range.start, lt: range.end } } })
    ]);
    const totals = this.totals(records);
    return {
      id: `finance-${period}-${range.label}`,
      date: range.label,
      period,
      newWorkOrders,
      approvedCount,
      rejectedCount,
      anomalyCount,
      totalIncome: totals.income,
      totalExpense: totals.expense,
      estimatedProfit: totals.profit,
      expenseCategories: this.expenseCategories(records),
      aiSummary: anomalyCount
        ? `本周期发现${anomalyCount}项规则异常，需要财务优先核对。`
        : '本周期规则复核未发现未处理异常。'
    };
  }

  async boss(dto: QueryBossReportDto) {
    const periodMap = { daily: 'today', weekly: 'week', monthly: 'month' } as const;
    const period = dto.period ?? 'daily';
    const range = reportRange(periodMap[period]);
    const [records, pendingApprovals, anomalies] = await Promise.all([
      this.findRecords(range.start, range.end),
      this.prisma.workOrder.count({ where: { status: WorkOrderStatus.boss_pending } }),
      this.prisma.aiAnomaly.findMany({
        where: { status: AnomalyStatus.open, detectedAt: { gte: range.start, lt: range.end } },
        orderBy: [{ riskLevel: 'desc' }, { detectedAt: 'desc' }],
        take: 20,
        include: { workOrder: true }
      })
    ]);
    const totals = this.totals(records);
    const projectRanking = this.projectRanking(records);
    return {
      id: `boss-${period}-${range.label}`,
      period,
      title: period === 'daily' ? '经营日报' : period === 'weekly' ? '经营周报' : '经营月报',
      date: range.label,
      income: totals.income,
      expense: totals.expense,
      profit: totals.profit,
      anomalies: anomalies.map((item) => `${item.workOrder.orderNo}：${item.reason}`),
      anomalyCount: anomalies.length,
      pendingApprovals,
      projectRanking,
      aiSummary: `本周期收入${totals.income}元，支出${totals.expense}元，利润${totals.profit}元。`,
      aiSuggestion: anomalies.length ? '建议优先处理高风险异常工单。' : '暂无未处理异常，按正常审批节奏推进。'
    };
  }

  async projectDaily(projectId: string, dto: QueryDailyReportDto) {
    const project = await this.findProject(projectId);
    const range = dayRange(dto.date);
    const records = await this.findRecords(range.start, range.end, projectId);
    return {
      project: { id: project.id, name: project.name },
      date: range.label,
      ...this.totals(records),
      recordCount: records.length,
      expenseCategories: this.expenseCategories(records)
    };
  }

  async projectMonthly(projectId: string, dto: QueryMonthlyReportDto) {
    const project = await this.findProject(projectId);
    const range = monthRange(dto.month);
    const records = await this.findRecords(range.start, range.end, projectId);
    const days = new Map<string, RecordWithProject[]>();
    for (const record of records) {
      const date = formatChinaDate(record.recordDate);
      days.set(date, [...(days.get(date) ?? []), record]);
    }
    return {
      project: { id: project.id, name: project.name },
      month: range.label,
      ...this.totals(records),
      recordCount: records.length,
      expenseCategories: this.expenseCategories(records),
      dailyTrend: Array.from(days.entries())
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([date, dayRecords]) => ({ date, ...this.totals(dayRecords) }))
    };
  }

  async projectSummary(projectId: string) {
    const project = await this.findProject(projectId);
    const records = await this.prisma.businessRecord.findMany({
      where: { projectId, status: { not: BusinessRecordStatus.rejected } },
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
        status: { not: BusinessRecordStatus.rejected },
        recordDate: { gte: start, lt: end }
      },
      include: { project: true },
      orderBy: { recordDate: 'asc' }
    });
  }

  private totals(records: RecordWithProject[]) {
    let income = 0;
    let expense = 0;
    for (const record of records) {
      if (this.isIncome(record)) income += Number(record.amount);
      else expense += Number(record.amount);
    }
    return { income, expense, profit: income - expense };
  }

  private expenseCategories(records: RecordWithProject[]) {
    const categories = new Map<string, number>();
    for (const record of records.filter((item) => !this.isIncome(item))) {
      const name = record.subCategory || record.category || '未分类';
      categories.set(name, (categories.get(name) ?? 0) + Number(record.amount));
    }
    return Array.from(categories.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((first, second) => second.amount - first.amount);
  }

  private projectRanking(records: RecordWithProject[]) {
    const groups = new Map<string, RecordWithProject[]>();
    for (const record of records) groups.set(record.projectId, [...(groups.get(record.projectId) ?? []), record]);
    return Array.from(groups.entries())
      .map(([projectId, projectRecords]) => ({
        projectId,
        projectName: projectRecords[0].project.name,
        ...this.totals(projectRecords)
      }))
      .sort((first, second) => second.profit - first.profit);
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
