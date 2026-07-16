import { AiMessageRole, UserRole, UserStatus } from '@prisma/client';

import { AiProviderService } from '../src/ai/ai-provider.service';
import { AiAnswerGroundingService } from '../src/ai/ai-answer-grounding.service';
import { AiService } from '../src/ai/ai.service';
import { AiToolsService } from '../src/ai/ai-tools.service';
import { MockAiProviderService } from '../src/ai/mock-ai-provider.service';

const boss = {
  id: 'boss_1',
  username: 'boss',
  name: '老板',
  role: UserRole.boss,
  department: '',
  phone: '',
  status: UserStatus.active,
  tokenVersion: 0
};

describe('phase 8 boss AI assistant', () => {
  it('routes questions only through approved structured-data tools', async () => {
    const project = { id: 'project_1', name: '太和项目', customerName: '太和物流', status: 'archived', createdAt: new Date() };
    const prisma: any = {
      project: { findMany: jest.fn(async () => [project]) },
      workOrder: { findUnique: jest.fn(async () => null) }
    };
    const reports: any = {
      boss: jest.fn(async () => ({ income: 1000, expense: 400, profit: 600, pendingApprovals: 1, anomalyCount: 1 })),
      finance: jest.fn(async () => ({ totalIncome: 1000, totalExpense: 400, estimatedProfit: 600 })),
      projectSummary: jest.fn(async () => ({ project: { id: project.id, name: project.name }, income: 800, expense: 300, profit: 500, recordCount: 2 })),
      projectMonthly: jest.fn(async () => ({ project: { id: project.id, name: project.name }, income: 700, expense: 250, profit: 450, recordCount: 3 })),
      projectPeriodSummary: jest.fn(async () => ({ project: { id: project.id, name: project.name }, income: 700, expense: 250, profit: 450, recordCount: 3 })),
      bossComparison: jest.fn(async () => ({ current: { recordCount: 1 }, baseline: { recordCount: 1 } })),
      projectComparison: jest.fn(async () => ({ current: { recordCount: 1 }, baseline: { recordCount: 1 } })),
      ranking: jest.fn(async ({ groupBy, direction, metric }) => ({
        groupBy,
        direction,
        metric,
        period: '2026-07',
        items: [{ scopeType: groupBy, scopeId: 'project_1', scopeName: project.name, profit: '450.00' }]
      })),
      pendingApprovals: jest.fn(async () => [{ orderNo: 'WO1', projectName: project.name, amount: 200, riskLevel: 'medium' }])
    };
    const riskRules: any = {
      findAnomalies: jest.fn(async () => ({ items: [{ orderNo: 'WO2', riskLevel: 'high', reason: '金额异常' }] }))
    };
    const workOrders: any = { findOne: jest.fn() };
    const tools = new AiToolsService(prisma, reports, riskRules, workOrders);

    const today = await tools.buildContext('今天经营情况怎么样', undefined, boss);
    expect(today.map((item) => item.name)).toEqual(['get_today_report']);

    const projectResult = await tools.buildContext('太和项目收入成本利润如何', undefined, boss);
    expect(projectResult.find((item) => item.name === 'get_project_summary')?.data).toMatchObject({ profit: 500 });
    const monthlyProject = await tools.buildContext('太和物流本月赚钱吗', undefined, boss);
    expect(monthlyProject.find((item) => item.name === 'get_project_summary')?.data).toMatchObject({ profit: 450 });
    expect(reports.projectPeriodSummary).toHaveBeenCalledWith(project.id, 'month', undefined);

    const monthlyRanking = await tools.buildContext('本月哪个项目利润最高', undefined, boss);
    expect(monthlyRanking.map((item) => item.name)).toEqual(['get_finance_ranking']);
    expect(reports.ranking).toHaveBeenCalledWith({
      period: 'monthly',
      date: undefined,
      groupBy: 'project',
      direction: 'highest',
      metric: 'profit'
    });
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ where: expect.anything() }));

    const operations = await tools.buildContext('列出待审批和异常工单', undefined, boss);
    expect(operations.map((item) => item.name)).toEqual(['get_pending_approvals', 'get_anomalies']);

    const missing = await tools.buildContext('不存在项目利润多少', undefined, boss);
    expect(missing.find((item) => item.name === 'get_project_summary')?.data).toMatchObject({ error: expect.any(String) });
  });

  it('handles adversarial repeated intent text without backtracking regular expressions', async () => {
    const prisma: any = {
      project: { findMany: jest.fn(async () => []) },
      workOrder: { findUnique: jest.fn(async () => null) }
    };
    const reports: any = { boss: jest.fn(async () => ({ recordCount: 0 })) };
    const riskRules: any = { findAnomalies: jest.fn(async () => ({ items: [] })) };
    const workOrders: any = { findOne: jest.fn(async () => ({ id: 'work_order_1' })) };
    const tools = new AiToolsService(prisma, reports, riskRules, workOrders);

    const repeatedQuestion = `${'有哪些'.repeat(600)}可疑`;
    const contexts = await tools.buildContext(repeatedQuestion, 'work_order_1', boss);

    expect(contexts.map((item) => item.name)).toEqual(['get_work_order_detail']);
    expect(riskRules.findAnomalies).not.toHaveBeenCalled();

    const grounding = new AiAnswerGroundingService();
    const reportContexts: any = [{
      name: 'get_today_report',
      data: { income: '100.00', expense: '40.00', profit: '60.00', recordCount: 2 }
    }];
    const income = grounding.createExpectedEnvelope(reportContexts, '收入多少');
    expect(grounding.validate(JSON.stringify(income), reportContexts, '收入多少')).toMatchObject({ accepted: true });
    const count = grounding.createExpectedEnvelope(reportContexts, '一共有多少条记录');
    expect(grounding.validate(JSON.stringify(count), reportContexts, '一共有多少条记录')).toMatchObject({ accepted: true });
    expect(grounding.validate(JSON.stringify(income), reportContexts, '一共有多少条记录')).toMatchObject({ accepted: false });
  });

  it('uses the mock provider without a model deployment and logs every call', async () => {
    const now = new Date();
    const conversations: any[] = [];
    const messages: any[] = [];
    const callLogs: any[] = [];
    const prisma: any = {
      aiConversation: {
        create: jest.fn(async ({ data }) => {
          const item = { id: `conversation_${conversations.length + 1}`, createdAt: now, updatedAt: now, ...data };
          conversations.push(item);
          return item;
        }),
        findUnique: jest.fn(async ({ where }) => conversations.find((item) => item.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }) => {
          const item = conversations.find((conversation) => conversation.id === where.id);
          Object.assign(item, data);
          return item;
        })
      },
      aiMessage: {
        create: jest.fn(async ({ data }) => {
          const item = { id: `message_${messages.length + 1}`, createdAt: new Date(), ...data };
          messages.push(item);
          return item;
        }),
        findMany: jest.fn(async ({ where, take }) => messages
          .filter((item) => item.conversationId === where.conversationId && item.id !== where.id?.not)
          .slice(-take)
          .reverse())
      },
      aiModelConfig: {
        findFirst: jest.fn(async () => ({ id: 'model_mock', provider: 'mock', modelName: 'mock-structured-v1', baseUrl: null }))
      },
      aiPromptVersion: {
        findFirst: jest.fn(async () => ({ id: 'prompt_v1', systemPrompt: '只能依据工具数据回答。' }))
      },
      aiCallLog: {
        create: jest.fn(async ({ data }) => {
          const item = { id: `call_${callLogs.length + 1}`, createdAt: new Date(), ...data };
          callLogs.push(item);
          return item;
        })
      },
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const tools: any = {
      buildContext: jest.fn(async () => [
        {
          name: 'get_today_report',
          data: { income: 1000, expense: 400, profit: 600, recordCount: 2, pendingApprovals: 2, anomalyCount: 1 }
        }
      ])
    };
    const provider = new AiProviderService(new MockAiProviderService(), {} as any);
    const auditLogs = { write: jest.fn(async () => undefined) };
    const config: any = {
      get: jest.fn((key: string) => ({ 'ai.provider': 'mock', 'ai.model': 'unused' })[key])
    };
    const modelRuntime: any = {
      resolve: jest.fn(async () => undefined),
      resolveSecret: jest.fn(() => undefined)
    };
    const grounding = new AiAnswerGroundingService();
    const service = new AiService(prisma, tools, provider, auditLogs as any, config, modelRuntime, grounding);

    const result = await service.chat({ message: '今天经营情况', history: [] }, boss, {});
    expect(result.reply).toContain('收入1000元');
    expect(result.reply).toContain('利润600元');
    expect(result.toolsUsed).toEqual(['get_today_report']);
    expect(result.provider).toBe('mock');
    expect(result.callLogId).toBe('call_1');
    expect(result.toolCalls).toEqual([{ toolName: 'get_today_report' }]);
    expect(result.fallback).toBe(false);
    expect(modelRuntime.resolve).toHaveBeenCalledWith('boss_chat');
    expect(messages.map((item) => item.role)).toEqual([AiMessageRole.user, AiMessageRole.assistant]);
    expect(callLogs).toHaveLength(1);
    expect(callLogs[0]).toMatchObject({ success: true, modelName: 'mock-structured-v1', provider: 'mock' });
    expect(auditLogs.write).toHaveBeenCalledWith(expect.anything(), boss, 'ai.chat', 'ai_conversation', result.conversationId, expect.anything(), {});

    const failingService = new AiService(
      prisma,
      tools,
      { generate: jest.fn(async () => { throw new Error('provider unavailable'); }) } as any,
      auditLogs as any,
      config,
      modelRuntime,
      grounding
    );
    const failed = await failingService.chat({ message: '再查一次今日经营' }, boss, {});
    expect(failed.fallback).toBe(true);
    expect(failed.callLogId).toBe('call_2');
    expect(failed.reply).toContain('需要人工确认');
    expect(callLogs).toHaveLength(2);
    expect(callLogs[1]).toMatchObject({ success: false, errorMessage: 'provider unavailable' });

    const historyProvider = {
      generate: jest.fn(async () => ({ text: '上个月利润600元。', inputTokens: 20, outputTokens: 8, raw: {} }))
    };
    const historyService = new AiService(
      prisma,
      tools,
      historyProvider as any,
      auditLogs as any,
      config,
      modelRuntime,
      grounding
    );
    await historyService.chat(
      { message: '那上个月呢？', conversationId: result.conversationId },
      boss,
      {}
    );
    expect(historyProvider.generate).toHaveBeenCalledWith(expect.objectContaining({
      history: [
        expect.objectContaining({ role: AiMessageRole.user, content: '今天经营情况' }),
        expect.objectContaining({ role: AiMessageRole.assistant })
      ],
      question: '那上个月呢？'
    }));
    expect(callLogs).toHaveLength(3);
  });
});
