import { Injectable } from '@nestjs/common';
import { JSONSchemaType } from 'ajv';

import { StructuredOutputValidatorService } from '../model-runtime/structured-output-validator.service';
import {
  AiClaimEnvelope,
  AiClaimMetric,
  AiFinancialClaim,
  AiToolContext,
  AiToolName
} from './ai.types';

export type AiGroundingErrorCategory =
  | 'schema'
  | 'no_data_claim'
  | 'claim_count'
  | 'scope'
  | 'period'
  | 'metric'
  | 'value'
  | 'unit'
  | 'source_tool'
  | 'source_path';

export interface AiGroundingResult {
  accepted: boolean;
  reason?: string;
  errorCategory?: AiGroundingErrorCategory;
  claims?: AiFinancialClaim[];
  answer?: string;
}

const CLAIM_ENVELOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scopeType', 'scopeId', 'period', 'metric', 'value', 'unit', 'sourceTool', 'sourcePath'],
        properties: {
          scopeType: { type: 'string', enum: ['company', 'project', 'customer', 'work_order'] },
          scopeId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9:_-]+$' },
          period: {
            type: 'string',
            maxLength: 43,
            pattern: '^(?:all|\\d{4}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}/\\d{4}-\\d{2}-\\d{2}|\\d{4}-\\d{2}(?:-\\d{2})?_vs_\\d{4}-\\d{2}(?:-\\d{2})?)$'
          },
          metric: { type: 'string', enum: ['income', 'expense', 'profit', 'record_count', 'risk'] },
          value: { type: 'string', maxLength: 32, pattern: '^-?(?:0|[1-9]\\d{0,15})(?:\\.\\d{1,4})?$' },
          unit: { type: 'string', enum: ['CNY', 'count'] },
          sourceTool: {
            type: 'string',
            enum: [
              'get_today_report',
              'get_finance_report',
              'get_project_summary',
              'get_period_comparison',
              'get_finance_ranking',
              'get_pending_approvals',
              'get_anomalies',
              'get_work_order_detail'
            ]
          },
          sourcePath: {
            type: 'string',
            maxLength: 160,
            pattern: '^data(?:\\.[A-Za-z][A-Za-z0-9_]*|\\[\\d+\\])+$'
          }
        }
      }
    }
  }
} as JSONSchemaType<AiClaimEnvelope>;

const ERROR_REASONS: Record<AiGroundingErrorCategory, string> = {
  schema: '模型未返回合法的 Claim Schema',
  no_data_claim: '工具无数据时模型仍声明了财务数字',
  claim_count: '模型 Claim 数量与当前问题所需事实不一致',
  scope: '模型 Claim 的业务范围与工具事实不一致',
  period: '模型 Claim 的统计期间与工具事实不一致',
  metric: '模型 Claim 的财务指标与工具事实不一致',
  value: '模型 Claim 的数值与工具事实不一致',
  unit: '模型 Claim 的单位与财务指标不一致',
  source_tool: '模型 Claim 引用了错误的工具',
  source_path: '模型 Claim 引用了错误的数据字段'
};

@Injectable()
export class AiAnswerGroundingService {
  constructor(
    private readonly structuredOutput: StructuredOutputValidatorService = new StructuredOutputValidatorService()
  ) {}

  createExpectedEnvelope(contexts: AiToolContext[], question: string): AiClaimEnvelope {
    return { claims: contexts.flatMap((context) => this.expectedForContext(context, question)) };
  }

  validate(output: string, contexts: AiToolContext[], question = ''): AiGroundingResult {
    let received: AiClaimEnvelope;
    try {
      received = this.structuredOutput.parseAndValidate(CLAIM_ENVELOPE_SCHEMA, output);
    } catch {
      return this.rejected('schema');
    }

    const expected = this.createExpectedEnvelope(contexts, question).claims;
    if (!expected.length && received.claims.length) return this.rejected('no_data_claim');
    if (expected.length !== received.claims.length) return this.rejected('claim_count');

    const matched = new Set<number>();
    for (const claim of received.claims) {
      const pathIndex = expected.findIndex((candidate, index) =>
        !matched.has(index) && candidate.sourcePath === claim.sourcePath
      );
      if (pathIndex < 0) return this.rejected('source_path');
      const candidate = expected[pathIndex];
      if (candidate.sourceTool !== claim.sourceTool) return this.rejected('source_tool');
      if (candidate.scopeType !== claim.scopeType || candidate.scopeId !== claim.scopeId) return this.rejected('scope');
      if (candidate.period !== claim.period) return this.rejected('period');
      if (candidate.metric !== claim.metric) return this.rejected('metric');
      if (candidate.value !== claim.value) return this.rejected('value');
      if (candidate.unit !== claim.unit) return this.rejected('unit');
      matched.add(pathIndex);
    }

    return {
      accepted: true,
      claims: expected,
      answer: this.render(contexts, question, expected)
    };
  }

  private rejected(errorCategory: AiGroundingErrorCategory): AiGroundingResult {
    return { accepted: false, errorCategory, reason: ERROR_REASONS[errorCategory] };
  }

  private expectedForContext(context: AiToolContext, question: string): AiFinancialClaim[] {
    const data = context.data as any;
    if (!data || data.error) return [];
    if (context.name === 'get_period_comparison') return this.comparisonClaims(context.name, data, question);
    if (context.name === 'get_finance_ranking') return this.rankingClaims(context.name, data);
    if (['get_today_report', 'get_finance_report', 'get_project_summary'].includes(context.name)) {
      return this.summaryClaims(context.name, data, question);
    }
    return [];
  }

  private summaryClaims(sourceTool: AiToolName, data: any, question: string) {
    if (Number(data.recordCount ?? 0) === 0) return [];
    const scope = data.project?.id
      ? { scopeType: 'project' as const, scopeId: String(data.project.id) }
      : { scopeType: 'company' as const, scopeId: 'company' };
    const period = this.period(data);
    const metrics = this.requestedMetrics(question, true);
    const paths: Partial<Record<AiClaimMetric, string>> = sourceTool === 'get_finance_report'
      ? {
          income: 'data.totalIncome',
          expense: 'data.totalExpense',
          profit: 'data.estimatedProfit',
          record_count: 'data.recordCount',
          risk: 'data.anomalyCount'
        }
      : {
          income: 'data.income',
          expense: 'data.expense',
          profit: 'data.profit',
          record_count: 'data.recordCount',
          risk: 'data.anomalyCount'
        };
    return metrics.flatMap((metric) => {
      const path = paths[metric];
      const raw = path ? this.pathValue({ data }, path) : undefined;
      if (path === undefined || raw === undefined || raw === null || !this.isClaimNumber(raw)) return [];
      return [this.claim(scope.scopeType, scope.scopeId, period, metric, String(raw), sourceTool, path)];
    });
  }

  private comparisonClaims(sourceTool: AiToolName, data: any, question: string) {
    if (Number(data.current?.recordCount ?? 0) === 0 && Number(data.baseline?.recordCount ?? 0) === 0) return [];
    const metric = this.requestedMetrics(question, false).find((item) =>
      item === 'income' || item === 'expense' || item === 'profit'
    ) ?? 'profit';
    const scope = data.project?.id
      ? { scopeType: 'project' as const, scopeId: String(data.project.id) }
      : { scopeType: 'company' as const, scopeId: 'company' };
    const currentPeriod = this.period(data.current);
    const baselinePeriod = this.period(data.baseline);
    const entries = [
      { path: `data.current.${metric}`, period: currentPeriod },
      { path: `data.baseline.${metric}`, period: baselinePeriod },
      { path: `data.changes.${metric}.delta`, period: `${currentPeriod}_vs_${baselinePeriod}` }
    ];
    return entries.flatMap(({ path, period }) => {
      const raw = this.pathValue({ data }, path);
      if (raw === undefined || raw === null || !this.isClaimNumber(raw)) return [];
      return [this.claim(scope.scopeType, scope.scopeId, period, metric, String(raw), sourceTool, path)];
    });
  }

  private rankingClaims(sourceTool: AiToolName, data: any) {
    const item = Array.isArray(data.items) ? data.items[0] : undefined;
    const metric = data.metric as AiClaimMetric;
    const path = `data.items[0].${metric}`;
    const raw = item?.[metric];
    if (
      !item ||
      !['project', 'customer'].includes(item.scopeType) ||
      !['income', 'expense', 'profit', 'record_count', 'risk'].includes(metric) ||
      !this.isClaimNumber(raw)
    ) return [];
    return [this.claim(
      item.scopeType,
      String(item.scopeId),
      String(data.period),
      metric,
      String(raw),
      sourceTool,
      path
    )];
  }

  private claim(
    scopeType: AiFinancialClaim['scopeType'],
    scopeId: string,
    period: string,
    metric: AiClaimMetric,
    value: string,
    sourceTool: AiToolName,
    sourcePath: string
  ): AiFinancialClaim {
    return {
      scopeType,
      scopeId,
      period,
      metric,
      value,
      unit: metric === 'record_count' || metric === 'risk' ? 'count' : 'CNY',
      sourceTool,
      sourcePath
    };
  }

  private requestedMetrics(question: string, defaultFinancials: boolean): AiClaimMetric[] {
    const metrics: AiClaimMetric[] = [];
    if (/收入/.test(question)) metrics.push('income');
    if (/成本|支出/.test(question)) metrics.push('expense');
    if (/利润|赚钱|亏损|盈利/.test(question)) metrics.push('profit');
    if (/记录数|多少(?:条)?(?:经营)?记录|经营记录.*多少/.test(question)) metrics.push('record_count');
    if (/异常数|风险数|多少(?:项)?异常/.test(question)) metrics.push('risk');
    if (!metrics.length && defaultFinancials && /经营|财务|日报|周报|月报|情况/.test(question)) {
      metrics.push('income', 'expense', 'profit');
    }
    return [...new Set(metrics)];
  }

  private period(data: any) {
    if (typeof data?.month === 'string' && /^\d{4}-\d{2}$/.test(data.month)) return data.month;
    const start = data?.range?.startDate;
    const end = data?.range?.endDate;
    if (typeof start !== 'string' || typeof end !== 'string') return 'all';
    if (data.period === 'monthly' || data.period === 'month') return start.slice(0, 7);
    if (data.period === 'weekly' || data.period === 'week') return `${start}/${end}`;
    if (data.period === 'daily' || data.period === 'today' || start === end) return start;
    if (start.slice(0, 7) === end.slice(0, 7) && start.endsWith('-01')) return start.slice(0, 7);
    return `${start}/${end}`;
  }

  private pathValue(root: any, path: string) {
    const segments = path
      .replace(/^data\.?/, '')
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean);
    let value = root.data;
    for (const segment of segments) value = value?.[segment];
    return value;
  }

  private isClaimNumber(value: unknown) {
    return typeof value === 'string'
      ? /^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(value)
      : typeof value === 'number' && Number.isSafeInteger(value);
  }

  private render(contexts: AiToolContext[], question: string, claims: AiFinancialClaim[]) {
    const sections = contexts.map((context) => this.renderContext(context, question, claims)).filter(Boolean);
    return sections.join('\n\n') || '当前结构化数据不足，需要人工确认。';
  }

  private renderContext(context: AiToolContext, question: string, claims: AiFinancialClaim[]) {
    const data = context.data as any;
    if (data?.error) return `${this.safeLabel(data.error)}，需要人工确认。`;
    const ownClaims = claims.filter((claim) => claim.sourceTool === context.name);
    if (['get_today_report', 'get_finance_report', 'get_project_summary'].includes(context.name)) {
      if (!ownClaims.length) {
        const scope = data?.project?.name ? this.safeLabel(data.project.name) : '当前期间';
        return `${scope}没有已确认实绩经营记录，需要人工确认统计期间。`;
      }
      const scope = data?.project?.name ? this.safeLabel(data.project.name) : '公司';
      return `${scope}（${ownClaims[0].period}）：${ownClaims.map((claim) => this.renderClaim(claim)).join('，')}。数据来源：${context.name}。`;
    }
    if (context.name === 'get_period_comparison') {
      if (!ownClaims.length) return `${this.safeLabel(data.label ?? '期间比较')}没有已确认实绩经营记录，需要人工确认。`;
      const current = ownClaims.find((claim) => claim.sourcePath.includes('.current.'));
      const baseline = ownClaims.find((claim) => claim.sourcePath.includes('.baseline.'));
      const delta = ownClaims.find((claim) => claim.sourcePath.includes('.changes.'));
      const scope = data.project?.name ? `${this.safeLabel(data.project.name)} ` : '';
      const label = this.metricLabel(current?.metric ?? 'profit');
      return `${scope}${this.safeLabel(data.label ?? '期间比较')}：本期${current?.period}${label}${current?.value}元；基期${baseline?.period}${label}${baseline?.value}元；差额${delta?.value}元。数据来源：${context.name}。`;
    }
    if (context.name === 'get_finance_ranking') {
      if (!ownClaims.length || !data.items?.[0]) return '当前排行没有已确认实绩经营记录，需要人工确认。';
      const claim = ownClaims[0];
      const group = data.groupBy === 'customer' ? '客户' : '项目';
      const direction = data.direction === 'lowest' ? '最低' : '最高';
      return `${claim.period}${group}${this.metricLabel(claim.metric)}${direction}：${this.safeLabel(data.items[0].scopeName)}${claim.value}${claim.unit === 'CNY' ? '元' : '项'}。数据来源：${context.name}。`;
    }
    if (context.name === 'get_pending_approvals') {
      if (!Array.isArray(data) || !data.length) return '当前没有待老板审批工单。';
      return `待老板审批工单：${data.map((item: any) => `${this.safeLabel(item.orderNo)}（${this.safeLabel(item.projectName)}，${item.amount}元，风险${this.safeLabel(item.riskLevel)}）`).join('；')}。`;
    }
    if (context.name === 'get_anomalies') {
      if (!Array.isArray(data) || !data.length) return '当前没有未处理异常工单。';
      return `异常工单：${data.map((item: any) => `${this.safeLabel(item.orderNo)}（${this.safeLabel(item.riskLevel)}，${this.safeLabel(item.reason)}）`).join('；')}。`;
    }
    if (context.name === 'get_work_order_detail') {
      return `工单${this.safeLabel(data.orderNo)}：项目${this.safeLabel(data.projectName)}，金额${data.amount}元，状态${this.safeLabel(data.status)}，风险${this.safeLabel(data.riskLevel)}。`;
    }
    return '';
  }

  private renderClaim(claim: AiFinancialClaim) {
    const suffix = claim.unit === 'CNY' ? '元' : claim.metric === 'record_count' ? '条' : '项';
    return `${this.metricLabel(claim.metric)}${claim.value}${suffix}`;
  }

  private metricLabel(metric: AiClaimMetric) {
    return ({
      income: '收入',
      expense: '支出',
      profit: '利润',
      record_count: '经营记录',
      risk: '异常'
    } as const)[metric];
  }

  private safeLabel(value: unknown) {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    if (/忽略|系统提示|developer\s+message|指令|api[ _-]?key|password|secret|token|https?:\/\/|执行命令|powershell|\bcurl\b/i.test(text)) {
      return '[不可信文本已隐藏]';
    }
    return text;
  }
}
