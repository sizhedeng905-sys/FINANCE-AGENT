import { Injectable } from '@nestjs/common';

import { AiProviderRequest, AiProviderResult, AiToolContext } from './ai.types';

@Injectable()
export class MockAiProviderService {
  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const sections = request.contexts.map((context) => this.render(context));
    const text = sections.filter(Boolean).join('\n\n') || '当前结构化数据不足，需要人工确认。';
    return {
      text,
      inputTokens: 0,
      outputTokens: 0,
      raw: { provider: 'mock', tools: request.contexts.map((item) => item.name), text }
    };
  }

  private render(context: AiToolContext) {
    const data = context.data as any;
    if (data?.error) return `${data.error}，需要人工确认。`;
    if (context.name === 'get_today_report' || context.name === 'get_finance_report') {
      const income = data.income ?? data.totalIncome ?? 0;
      const expense = data.expense ?? data.totalExpense ?? 0;
      const profit = data.profit ?? data.estimatedProfit ?? income - expense;
      const periodLabel = data.period === 'monthly' || data.period === 'month'
        ? '本月'
        : data.period === 'weekly' || data.period === 'week'
          ? '本周'
          : '今日';
      const ranking = Array.isArray(data.projectRanking) && data.projectRanking.length
        ? ` 项目利润排行：${data.projectRanking.map((item: any) => `${item.projectName}${item.profit}元`).join('；')}。`
        : '';
      return `${periodLabel}收入${income}元，支出${expense}元，利润${profit}元；待审批${data.pendingApprovals ?? 0}项，异常${data.anomalyCount ?? 0}项。${ranking}`;
    }
    if (context.name === 'get_project_summary') {
      return `${data.project.name}：收入${data.income}元，成本${data.expense}元，利润${data.profit}元，共${data.recordCount}条经营记录。`;
    }
    if (context.name === 'get_pending_approvals') {
      if (!data.length) return '当前没有待老板审批工单。';
      return `待老板审批工单：${data.map((item: any) => `${item.orderNo}（${item.projectName}，${item.amount}元，风险${item.riskLevel}）`).join('；')}。`;
    }
    if (context.name === 'get_anomalies') {
      if (!data.length) return '当前没有未处理异常工单。';
      return `异常工单：${data.map((item: any) => `${item.orderNo}（${item.riskLevel}，${item.reason}）`).join('；')}。`;
    }
    if (context.name === 'get_work_order_detail') {
      return `工单${data.orderNo}：项目${data.projectName}，金额${data.amount}元，状态${data.status}，风险${data.riskLevel}。${data.aiSummary ?? ''}`;
    }
    return '当前结构化数据不足，需要人工确认。';
  }
}
