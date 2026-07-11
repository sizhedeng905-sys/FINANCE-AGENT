import { Injectable } from '@nestjs/common';

import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { RiskRulesService } from '../risk-rules/risk-rules.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { AiToolContext } from './ai.types';

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

    if (workOrderId || /WO[A-Z0-9-]+/i.test(question)) {
      contexts.push(await this.workOrderContext(question, workOrderId, user));
    }

    if (/项目|收入|成本|利润/.test(question)) {
      const projectContext = await this.projectContext(question);
      if (projectContext) contexts.push(projectContext);
    }

    if (/待审批|待老板|需要审批|审批哪些/.test(question)) {
      contexts.push({ name: 'get_pending_approvals', data: await this.reports.pendingApprovals() });
    }

    if (/异常|风险|可疑/.test(question)) {
      const anomalies = await this.riskRules.findAnomalies({ page: 1, pageSize: 100 });
      contexts.push({ name: 'get_anomalies', data: anomalies.items });
    }

    if (/财务日报|财务情况/.test(question)) {
      contexts.push({ name: 'get_finance_report', data: await this.reports.finance({ period: 'today' }) });
    }

    if (/今天|今日|经营情况|日报/.test(question) || contexts.length === 0) {
      contexts.push({ name: 'get_today_report', data: await this.reports.boss({ period: 'daily' }) });
    }

    return this.deduplicate(contexts);
  }

  private async projectContext(question: string): Promise<AiToolContext | null> {
    const projects = await this.prisma.project.findMany({
      where: { status: 'active' },
      orderBy: { createdAt: 'asc' },
      take: 500
    });
    const project = projects.find(
      (item) => question.includes(item.name) || question.includes(item.id) || question.includes(item.customerName)
    );
    if (project) {
      return { name: 'get_project_summary', data: await this.reports.projectSummary(project.id) };
    }
    if (/项目/.test(question)) {
      return { name: 'get_project_summary', data: { error: '项目不存在或问题中未提供可识别的项目名称' } };
    }
    return null;
  }

  private async workOrderContext(question: string, explicitId: string | undefined, user: CurrentUser): Promise<AiToolContext> {
    let id = explicitId;
    if (!id) {
      const orderNo = question.match(/WO[A-Z0-9-]+/i)?.[0];
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
