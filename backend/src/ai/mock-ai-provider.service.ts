import { Injectable } from '@nestjs/common';

import { AiProviderRequest, AiProviderResult, AiToolContext } from './ai.types';

@Injectable()
export class MockAiProviderService {
  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const sections = request.contexts.map((context) => this.render(context, request.question));
    const text = sections.filter(Boolean).join('\n\n') || '当前结构化数据不足，需要人工确认。';
    return {
      text,
      inputTokens: 0,
      outputTokens: 0,
      raw: { provider: 'mock', tools: request.contexts.map((item) => item.name), text }
    };
  }

  private render(context: AiToolContext, question: string) {
    const data = context.data as any;
    if (data?.error) return `${this.safeLabel(data.error)}，需要人工确认。`;
    if (context.name === 'get_today_report' || context.name === 'get_finance_report') {
      const income = data.income ?? data.totalIncome ?? 0;
      const expense = data.expense ?? data.totalExpense ?? 0;
      const profit = data.profit ?? data.estimatedProfit;
      const periodLabel = data.period === 'monthly' || data.period === 'month'
        ? '本月'
        : data.period === 'weekly' || data.period === 'week'
          ? '本周'
          : '今日';
      const recordCount = Number(data.recordCount ?? 0);
      const range = data.range?.startDate && data.range?.endDate
        ? `（${data.range.startDate}至${data.range.endDate}，北京时间）`
        : '';
      if (recordCount === 0) {
        return `${periodLabel}${range}没有已确认实绩经营记录；待审批${data.pendingApprovals ?? 0}项，异常${data.anomalyCount ?? 0}项。数据来源：已确认实绩经营记录。`;
      }
      if (profit === undefined) return '当前结构化数据不足，需要人工确认。';
      const ranking = Array.isArray(data.projectRanking) && data.projectRanking.length
        ? ` 项目利润排行：${data.projectRanking.map((item: any) => `${this.safeLabel(item.projectName)}${item.profit}元`).join('；')}。`
        : '';
      const categories = Array.isArray(data.expenseCategories) && data.expenseCategories.length
        ? ` 成本结构：${data.expenseCategories.map((item: any) => `${this.safeLabel(item.name)}${item.amount}元`).join('；')}。`
        : '';
      return `${periodLabel}${range}收入${income}元，支出${expense}元，利润${profit}元；待审批${data.pendingApprovals ?? 0}项，异常${data.anomalyCount ?? 0}项。${ranking}${categories}数据来源：已确认实绩经营记录。`;
    }
    if (context.name === 'get_project_summary') {
      const projectName = this.safeLabel(data.project?.name ?? '项目');
      if (Number(data.recordCount ?? 0) === 0) {
        return `${projectName}没有已确认实绩经营记录，需要人工确认统计期间。`;
      }
      const period = data.month ?? (data.range?.startDate && data.range?.endDate
        ? `${data.range.startDate}至${data.range.endDate}`
        : '全部已确认期间');
      return `${projectName}（${period}）：收入${data.income}元，成本${data.expense}元，利润${data.profit}元，共${data.recordCount}条经营记录。数据来源：已确认实绩经营记录。`;
    }
    if (context.name === 'get_period_comparison') {
      const current = data.current;
      const baseline = data.baseline;
      if (Number(current?.recordCount ?? 0) === 0 && Number(baseline?.recordCount ?? 0) === 0) {
        return `${this.safeLabel(data.label ?? '期间比较')}的两期均没有已确认实绩经营记录，需要人工确认。`;
      }
      const project = data.project?.name ? `${this.safeLabel(data.project.name)} ` : '';
      const metric = /收入/.test(question) ? 'income' : /支出|成本/.test(question) ? 'expense' : 'profit';
      const metricLabel = metric === 'income' ? '收入' : metric === 'expense' ? '支出' : '利润';
      return `${project}${this.safeLabel(data.label)}：本期${current.range.startDate}至${current.range.endDate}${metricLabel}${current[metric]}元；基期${baseline.range.startDate}至${baseline.range.endDate}${metricLabel}${baseline[metric]}元；差额${data.changes[metric].delta}元，变化率${data.changes[metric].rate ?? '基期为零，不计算'}。数据来源：两期已确认实绩经营记录。`;
    }
    if (context.name === 'get_pending_approvals') {
      if (!data.length) return '当前没有待老板审批工单。';
      return `待老板审批工单：${data.map((item: any) => `${this.safeLabel(item.orderNo)}（${this.safeLabel(item.projectName)}，${item.amount}元，风险${this.safeLabel(item.riskLevel)}）`).join('；')}。`;
    }
    if (context.name === 'get_anomalies') {
      if (!data.length) return '当前没有未处理异常工单。';
      return `异常工单：${data.map((item: any) => `${this.safeLabel(item.orderNo)}（${this.safeLabel(item.riskLevel)}，${this.safeLabel(item.reason)}）`).join('；')}。`;
    }
    if (context.name === 'get_work_order_detail') {
      return `工单${this.safeLabel(data.orderNo)}：项目${this.safeLabel(data.projectName)}，金额${data.amount}元，状态${this.safeLabel(data.status)}，风险${this.safeLabel(data.riskLevel)}。`;
    }
    return '当前结构化数据不足，需要人工确认。';
  }

  private safeLabel(value: unknown) {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    if (/忽略|系统提示|指令|api[ _-]?key|password|secret|token|https?:\/\/|执行命令|powershell|\bcurl\b/i.test(text)) {
      return '[不可信文本已隐藏]';
    }
    return text;
  }
}
