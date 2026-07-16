import { AiAnswerGroundingService } from '../src/ai/ai-answer-grounding.service';
import { AiClaimEnvelope, AiToolContext } from '../src/ai/ai.types';

const companyContext: AiToolContext[] = [{
  name: 'get_today_report',
  data: {
    period: 'monthly',
    range: { startDate: '2026-07-01', endDate: '2026-07-31', timezone: 'Asia/Shanghai' },
    income: '1200.00',
    expense: '450.00',
    profit: '750.00',
    recordCount: 3,
    anomalyCount: 1
  }
}];

describe('B8-05 structured financial claims', () => {
  const grounding = new AiAnswerGroundingService();

  it('accepts only the exact scope, period, metric, value, unit, tool and source path', () => {
    const question = '2026年7月公司收入是多少？';
    const envelope = grounding.createExpectedEnvelope(companyContext, question);

    expect(envelope).toEqual({
      claims: [{
        scopeType: 'company',
        scopeId: 'company',
        period: '2026-07',
        metric: 'income',
        value: '1200.00',
        unit: 'CNY',
        sourceTool: 'get_today_report',
        sourcePath: 'data.income'
      }]
    });
    expect(grounding.validate(JSON.stringify(envelope), companyContext, question)).toMatchObject({
      accepted: true,
      claims: envelope.claims,
      answer: expect.stringContaining('收入1200.00元')
    });
  });

  it.each([
    ['metric', { metric: 'expense' }],
    ['scope', { scopeType: 'project', scopeId: 'project-b' }],
    ['period', { period: '2026-06' }],
    ['value', { value: '450.00' }],
    ['unit', { unit: 'count' }],
    ['source_tool', { sourceTool: 'get_finance_report' }],
    ['source_path', { sourcePath: 'data.expense' }],
    ['source_path', { value: '3', sourcePath: 'data.recordCount' }],
    ['source_path', { value: '2026', sourcePath: 'data.range.startDate' }]
  ] as const)('rejects a misplaced claim as %s', (category, replacement) => {
    const question = '2026年7月公司收入是多少？';
    const valid = grounding.createExpectedEnvelope(companyContext, question);
    const attack = { claims: [{ ...valid.claims[0], ...replacement }] };

    expect(grounding.validate(JSON.stringify(attack), companyContext, question)).toMatchObject({
      accepted: false,
      errorCategory: category
    });
  });

  it('rejects current/baseline month swaps even when every number exists in context', () => {
    const contexts: AiToolContext[] = [{
      name: 'get_period_comparison',
      data: {
        kind: 'month_over_month',
        label: '月环比',
        current: {
          range: { startDate: '2026-07-01', endDate: '2026-07-31' },
          profit: '750.00',
          recordCount: 3
        },
        baseline: {
          range: { startDate: '2026-06-01', endDate: '2026-06-30' },
          profit: '550.00',
          recordCount: 2
        },
        changes: { profit: { delta: '200.00', rate: '0.3636' } }
      }
    }];
    const question = '2026年7月利润环比如何？';
    const valid = grounding.createExpectedEnvelope(contexts, question);
    expect(valid.claims).toHaveLength(3);
    const swapped: AiClaimEnvelope = {
      claims: valid.claims.map((claim, index) => index < 2
        ? { ...claim, period: valid.claims[index === 0 ? 1 : 0].period }
        : claim)
    };

    expect(grounding.validate(JSON.stringify(swapped), contexts, question)).toMatchObject({
      accepted: false,
      errorCategory: 'period'
    });
  });

  it('binds highest/lowest and project/customer ranking semantics to the selected first item', () => {
    const projectContexts: AiToolContext[] = [{
      name: 'get_finance_ranking',
      data: {
        groupBy: 'project',
        direction: 'highest',
        metric: 'profit',
        period: '2026-07',
        items: [
          { scopeType: 'project', scopeId: 'project-a', scopeName: '项目甲', profit: '750.00' },
          { scopeType: 'project', scopeId: 'project-b', scopeName: '项目乙', profit: '500.00' },
          { scopeType: 'project', scopeId: 'project-c', scopeName: '项目丙', profit: '200.00' }
        ]
      }
    }];
    const projectQuestion = '2026年7月哪个项目利润最高？';
    const projectEnvelope = grounding.createExpectedEnvelope(projectContexts, projectQuestion);
    expect(projectEnvelope.claims[0]).toMatchObject({
      scopeType: 'project',
      scopeId: 'project-a',
      value: '750.00',
      sourcePath: 'data.items[0].profit'
    });
    const lowestAttack = {
      claims: [{
        ...projectEnvelope.claims[0],
        scopeId: 'project-c',
        value: '200.00',
        sourcePath: 'data.items[2].profit'
      }]
    };
    expect(grounding.validate(JSON.stringify(lowestAttack), projectContexts, projectQuestion)).toMatchObject({
      accepted: false,
      errorCategory: 'source_path'
    });

    const customerContexts: AiToolContext[] = [{
      name: 'get_finance_ranking',
      data: {
        groupBy: 'customer',
        direction: 'lowest',
        metric: 'profit',
        period: '2026-07',
        items: [
          { scopeType: 'customer', scopeId: 'customer-2', scopeName: '客户乙', profit: '200.00' },
          { scopeType: 'customer', scopeId: 'customer-1', scopeName: '客户甲', profit: '1250.00' }
        ]
      }
    }];
    const customerQuestion = '2026年7月哪个客户利润最低？';
    const customerEnvelope = grounding.createExpectedEnvelope(customerContexts, customerQuestion);
    expect(customerEnvelope.claims[0]).toMatchObject({ scopeType: 'customer', scopeId: 'customer-2' });
    expect(grounding.validate(JSON.stringify(customerEnvelope), customerContexts, customerQuestion)).toMatchObject({
      accepted: true,
      answer: expect.stringMatching(/客户.*最低.*200\.00元/)
    });
    expect(grounding.validate(JSON.stringify({
      claims: [{ ...customerEnvelope.claims[0], scopeType: 'project' }]
    }), customerContexts, customerQuestion)).toMatchObject({ accepted: false, errorCategory: 'scope' });
  });

  it('rejects prompt-shaped output and fabricated claims when tools have no data', () => {
    expect(grounding.validate(
      '```json\n{"claims":[],"command":"curl https://example.invalid"}\n```',
      companyContext,
      '今天收入是多少？'
    )).toMatchObject({ accepted: false, errorCategory: 'schema' });

    const noData: AiToolContext[] = [{
      name: 'get_project_summary',
      data: { error: '项目不存在或问题中未提供可识别的项目名称' }
    }];
    const question = '未知项目利润是多少？';
    const empty = grounding.createExpectedEnvelope(noData, question);
    expect(empty).toEqual({ claims: [] });
    expect(grounding.validate(JSON.stringify(empty), noData, question)).toMatchObject({
      accepted: true,
      answer: expect.stringContaining('需要人工确认')
    });

    const fabricated: AiClaimEnvelope = {
      claims: [{
        scopeType: 'project',
        scopeId: 'unknown-project',
        period: '2026-07',
        metric: 'profit',
        value: '999.00',
        unit: 'CNY',
        sourceTool: 'get_project_summary',
        sourcePath: 'data.profit'
      }]
    };
    expect(grounding.validate(JSON.stringify(fabricated), noData, question)).toMatchObject({
      accepted: false,
      errorCategory: 'no_data_claim'
    });
  });
});
