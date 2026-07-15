import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AiToolContext } from './ai.types';

export interface AiGroundingResult {
  accepted: boolean;
  reason?: string;
}

const UNSAFE_OUTPUT_PATTERN = /忽略(?:之前|以上|系统)|系统提示|developer\s+message|api[ _-]?key|password|secret|\btoken\b|访问外部|执行命令|powershell|\bcurl\b/i;
const NO_DATA_PATTERN = /无(?:已确认|可用|相关)?数据|没有|暂无|不足|人工确认|未找到|不存在/;
const NUMBER_PATTERN = /[-+]?\d[\d,]*(?:\.\d+)?%?/g;

@Injectable()
export class AiAnswerGroundingService {
  validate(answer: string, contexts: AiToolContext[], question = ''): AiGroundingResult {
    const text = answer.trim();
    if (!text) return { accepted: false, reason: '模型未返回文本' };
    if (UNSAFE_OUTPUT_PATTERN.test(text)) {
      return { accepted: false, reason: '模型回答包含不安全指令或敏感凭据词' };
    }

    const allowedNumbers = new Set(this.extractNumbers(JSON.stringify(contexts)));
    const answerNumbers = this.extractNumbers(text);
    const ungrounded = answerNumbers.filter((number) => !allowedNumbers.has(number));
    if (ungrounded.length) {
      return { accepted: false, reason: '模型回答包含工具上下文未提供的数字' };
    }
    const noData = this.requiresNoDataDisclosure(contexts);
    if (noData && !NO_DATA_PATTERN.test(text)) {
      return { accepted: false, reason: '模型未明确说明结构化数据不足' };
    }
    if (!noData && allowedNumbers.size > 0 && answerNumbers.length === 0) {
      return { accepted: false, reason: '模型回答未引用任何结构化数字' };
    }
    const missingRequired = this.requiredNumbers(question, contexts)
      .filter((number) => !answerNumbers.includes(number));
    if (!noData && missingRequired.length) {
      return { accepted: false, reason: '模型回答缺少当前问题所需的工具数字' };
    }
    return { accepted: true };
  }

  private extractNumbers(value: string) {
    return (value.match(NUMBER_PATTERN) ?? []).map((token) => this.normalizeNumber(token));
  }

  private normalizeNumber(token: string) {
    const percentage = token.endsWith('%');
    const numeric = token.replace(/[% ,]/g, '');
    try {
      const normalized = new Prisma.Decimal(numeric).toString();
      return percentage ? `${normalized}%` : normalized;
    } catch {
      return token;
    }
  }

  private requiresNoDataDisclosure(contexts: AiToolContext[]) {
    return contexts.length > 0 && contexts.every((context) => {
      const data = context.data as any;
      if (data?.error) return true;
      if (context.name === 'get_pending_approvals' || context.name === 'get_anomalies') {
        return Array.isArray(data) && data.length === 0;
      }
      if (context.name === 'get_work_order_detail') return Boolean(data?.error);
      if (context.name === 'get_period_comparison') {
        return Number(data?.current?.recordCount ?? 0) === 0 && Number(data?.baseline?.recordCount ?? 0) === 0;
      }
      if (['get_today_report', 'get_finance_report', 'get_project_summary'].includes(context.name)) {
        return Number(data?.recordCount ?? 0) === 0;
      }
      return false;
    });
  }

  private requiredNumbers(question: string, contexts: AiToolContext[]) {
    const required: string[] = [];
    for (const context of contexts) {
      const data = context.data as any;
      if (context.name === 'get_today_report' || context.name === 'get_finance_report' || context.name === 'get_project_summary') {
        const income = data.income ?? data.totalIncome;
        const expense = data.expense ?? data.totalExpense;
        const profit = data.profit ?? data.estimatedProfit;
        if (/收入/.test(question) && income !== undefined) required.push(this.normalizeNumber(String(income)));
        if (/支出|成本/.test(question) && expense !== undefined) required.push(this.normalizeNumber(String(expense)));
        if (/利润|赚钱|亏损/.test(question) && profit !== undefined) required.push(this.normalizeNumber(String(profit)));
        if (/多少.*记录|记录.*多少/.test(question) && data.recordCount !== undefined) {
          required.push(this.normalizeNumber(String(data.recordCount)));
        }
        if (/哪个项目|哪个客户|排行|最高|最低/.test(question) && data.projectRanking?.[0]?.profit !== undefined) {
          required.push(this.normalizeNumber(String(data.projectRanking[0].profit)));
        }
        if (/经营情况|日报|周报|月报|财务情况/.test(question)) {
          for (const value of [income, expense, profit]) {
            if (value !== undefined) required.push(this.normalizeNumber(String(value)));
          }
        }
      }
      if (context.name === 'get_period_comparison') {
        const metric = /收入/.test(question) ? 'income' : /支出|成本/.test(question) ? 'expense' : 'profit';
        for (const value of [data.current?.[metric], data.baseline?.[metric], data.changes?.[metric]?.delta]) {
          if (value !== undefined) required.push(this.normalizeNumber(String(value)));
        }
      }
      if (context.name === 'get_work_order_detail' && /金额/.test(question) && data.amount !== undefined) {
        required.push(this.normalizeNumber(String(data.amount)));
      }
    }
    return [...new Set(required)];
  }
}
