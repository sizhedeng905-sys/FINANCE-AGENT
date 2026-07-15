import { Injectable } from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';

import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { formatChinaDate, shiftMonthDate } from '../reports/report-period';
import { RiskRulesService } from '../risk-rules/risk-rules.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { AiToolContext } from './ai.types';

type ComparisonKind = 'month_over_month' | 'year_over_year';
const WORK_ORDER_NUMBER_PATTERN = /\bWO(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/i;

interface PeriodIntent {
  bossPeriod: 'daily' | 'weekly' | 'monthly';
  financePeriod: 'today' | 'week' | 'month';
  date?: string;
  month?: string;
  scoped: boolean;
}

@Injectable()
export class AiToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly riskRules: RiskRulesService,
    private readonly workOrders: WorkOrdersService
  ) {}

  async buildContext(question: string, workOrderId: string | undefined, user: CurrentUser) {
    const contexts: AiToolContext[] = [];
    const normalized = question.trim().toLowerCase();
    const comparisonKind = this.comparisonKind(normalized);
    const period = this.periodIntent(question, comparisonKind !== undefined);

    if (workOrderId || WORK_ORDER_NUMBER_PATTERN.test(question)) {
      contexts.push(await this.workOrderContext(question, workOrderId, user));
    }

    if (/项目|客户|收入|成本|支出|利润|赚钱|亏损/.test(question)) {
      const projectContext = await this.projectContext(
        question,
        period,
        comparisonKind,
        /异常|风险|可疑|待审批/.test(question)
      );
      if (projectContext) contexts.push(projectContext);
    }

    if (
      comparisonKind
      && !contexts.some((context) => context.name === 'get_period_comparison' || context.name === 'get_project_summary')
    ) {
      contexts.push({
        name: 'get_period_comparison',
        data: await this.reports.bossComparison(comparisonKind, period.date)
      });
    }

    if (/待审批|待老板|需要审批|审批哪些/.test(question)) {
      contexts.push({ name: 'get_pending_approvals', data: await this.reports.pendingApprovals() });
    }

    const hasWorkOrderContext = contexts.some((context) => context.name === 'get_work_order_detail');
    if (
      /异常|风险|可疑/.test(question)
      && (!hasWorkOrderContext || /异常列表|异常工单|有哪些.*(?:异常|风险)|全部.*风险/.test(question))
    ) {
      const anomalies = await this.riskRules.findAnomalies({ page: 1, pageSize: 100 });
      contexts.push({ name: 'get_anomalies', data: anomalies.items });
    }

    if (/财务日报|财务情况/.test(question)) {
      contexts.push({
        name: 'get_finance_report',
        data: await this.reports.finance(
          period.date ? { period: period.financePeriod, date: period.date } : { period: period.financePeriod }
        )
      });
    }

    if (
      !comparisonKind
      && !contexts.some((context) => [
        'get_project_summary',
        'get_finance_report',
        'get_work_order_detail'
      ].includes(context.name))
      && (/今天|今日|本周|这周|本月|这个月|上月|上个月|经营情况|日报|周报|月报|\d{4}\s*年/.test(question)
        || contexts.length === 0)
    ) {
      contexts.push({
        name: 'get_today_report',
        data: await this.reports.boss(
          period.date ? { period: period.bossPeriod, date: period.date } : { period: period.bossPeriod }
        )
      });
    }

    return this.deduplicate(contexts);
  }

  private async projectContext(
    question: string,
    period: PeriodIntent,
    comparisonKind?: ComparisonKind,
    suppressMissingProjectError = false
  ): Promise<AiToolContext | null> {
    const mentionsProject = question.includes('项目') || question.includes('客户');
    const asksRanking = question.includes('哪个项目')
      || question.includes('哪个客户')
      || (mentionsProject && ['最高', '最低', '排行'].some((word) => question.includes(word)));
    if (asksRanking) return null;
    const matches = await this.findProjectMatches(question);
    const top = matches[0];
    const ambiguous = top
      ? matches.filter(
          (item) => item.matchPriority === top.matchPriority && item.matchLength === top.matchLength
        )
      : [];
    if (ambiguous.length > 1) {
      return {
        name: 'get_project_summary',
        data: {
          error: '项目名称或客户名称存在歧义，请提供项目 ID',
          candidates: ambiguous.slice(0, 10).map((item) => ({ id: item.id, name: item.name }))
        }
      };
    }
    const project = top;
    if (project) {
      if (comparisonKind) {
        return {
          name: 'get_period_comparison',
          data: await this.reports.projectComparison(project.id, comparisonKind, period.month)
        };
      }
      const data = period.scoped
        ? await this.reports.projectPeriodSummary(project.id, period.financePeriod, period.date)
        : await this.reports.projectSummary(project.id);
      return { name: 'get_project_summary', data };
    }
    if (!suppressMissingProjectError && /项目|客户/.test(question)) {
      return { name: 'get_project_summary', data: { error: '项目不存在或问题中未提供可识别的项目名称' } };
    }
    return null;
  }

  private comparisonKind(question: string): ComparisonKind | undefined {
    if (/同比|去年同期/.test(question)) return 'year_over_year';
    if (/环比|较上月|比上月|比上个月|与上月相比|和上月相比/.test(question)) return 'month_over_month';
    return undefined;
  }

  private periodIntent(question: string, comparison: boolean): PeriodIntent {
    const monthMatch = /(\d{4})\s*年\s*(1[0-2]|0?[1-9])\s*月/.exec(question);
    let date = monthMatch
      ? `${monthMatch[1]}-${String(Number(monthMatch[2])).padStart(2, '0')}-01`
      : undefined;
    if (!date && !comparison && /上月|上个月/.test(question)) {
      date = shiftMonthDate(formatChinaDate(new Date()), -1);
    }
    const monthly = comparison || Boolean(date) || /本月|这个月|月报/.test(question);
    const bossPeriod = monthly ? 'monthly' : /本周|这周|周报/.test(question) ? 'weekly' : 'daily';
    const scoped = monthly || /今天|今日|本周|这周|周报/.test(question);
    return {
      bossPeriod,
      financePeriod: bossPeriod === 'monthly' ? 'month' : bossPeriod === 'weekly' ? 'week' : 'today',
      date,
      month: date?.slice(0, 7),
      scoped
    };
  }

  private async findProjectMatches(question: string) {
    type Match = {
      id: string;
      name: string;
      customerName: string;
      matchPriority: number;
      matchLength: number;
    };
    if (typeof this.prisma.$queryRaw === 'function') {
      return this.prisma.$queryRaw<Match[]>`
        SELECT
          p."id",
          p."name",
          p."customer_name" AS "customerName",
          CASE
            WHEN strpos(${question}, p."id") > 0 THEN 3
            WHEN strpos(${question}, p."name") > 0 THEN 2
            ELSE 1
          END AS "matchPriority",
          CASE
            WHEN strpos(${question}, p."id") > 0 THEN length(p."id")
            WHEN strpos(${question}, p."name") > 0 THEN length(p."name")
            ELSE length(p."customer_name")
          END AS "matchLength"
        FROM "projects" AS p
        WHERE p."status" IN (${ProjectStatus.active}::"ProjectStatus", ${ProjectStatus.archived}::"ProjectStatus")
          AND (
            strpos(${question}, p."id") > 0
            OR (length(trim(p."name")) >= 2 AND strpos(${question}, p."name") > 0)
            OR (length(trim(p."customer_name")) >= 2 AND strpos(${question}, p."customer_name") > 0)
          )
        ORDER BY "matchPriority" DESC, "matchLength" DESC, p."id" ASC
        LIMIT 20
      `;
    }

    const projects = await this.prisma.project.findMany({ orderBy: { createdAt: 'asc' } });
    return projects
      .flatMap((item) => {
        if (question.includes(item.id)) {
          return [{ ...item, matchPriority: 3, matchLength: item.id.length }];
        }
        if (item.name.length >= 2 && question.includes(item.name)) {
          return [{ ...item, matchPriority: 2, matchLength: item.name.length }];
        }
        if (item.customerName.length >= 2 && question.includes(item.customerName)) {
          return [{ ...item, matchPriority: 1, matchLength: item.customerName.length }];
        }
        return [];
      })
      .sort((first, second) =>
        second.matchPriority - first.matchPriority || second.matchLength - first.matchLength || first.id.localeCompare(second.id)
      );
  }

  private async workOrderContext(question: string, explicitId: string | undefined, user: CurrentUser): Promise<AiToolContext> {
    let id = explicitId;
    if (!id) {
      const orderNo = question.match(WORK_ORDER_NUMBER_PATTERN)?.[0];
      if (orderNo) {
        const workOrder = await this.prisma.workOrder.findUnique({ where: { orderNo: orderNo.toUpperCase() }, select: { id: true } });
        id = workOrder?.id;
      }
    }
    if (!id) return { name: 'get_work_order_detail', data: { error: '工单不存在或问题中未提供可识别的工单编号' } };
    try {
      return { name: 'get_work_order_detail', data: await this.workOrders.findOne(id, user) };
    } catch {
      return { name: 'get_work_order_detail', data: { error: '工单不存在或当前用户无权查看' } };
    }
  }

  private deduplicate(contexts: AiToolContext[]) {
    const seen = new Set<string>();
    return contexts.filter((context) => {
      const key = `${context.name}:${JSON.stringify(context.data)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
