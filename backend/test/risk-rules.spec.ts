import { Prisma, RiskLevel, UserRole, UserStatus, WorkOrderStatus, WorkOrderType } from '@prisma/client';

import { RiskRulesService } from '../src/risk-rules/risk-rules.service';

const actor = {
  id: 'reviewer_1',
  username: 'reviewer',
  name: '复核员',
  role: UserRole.reviewer,
  department: '',
  phone: '',
  status: UserStatus.active,
  tokenVersion: 0
};

describe('RiskRulesService phase 6', () => {
  it('persists rule results and anomalies, chooses highest risk, and advances idempotently', async () => {
    const now = new Date('2026-07-11T02:00:00.000Z');
    const timeline: any[] = [];
    const results: any[] = [];
    const anomalies: any[] = [];
    const workOrder: any = {
      id: 'wo_1',
      orderNo: 'WO20260711001',
      type: WorkOrderType.expense,
      projectId: 'project_1',
      projectName: '测试项目',
      customerName: '测试客户',
      creatorId: 'employee_1',
      creatorName: '员工',
      amount: new Prisma.Decimal(25000),
      income: new Prisma.Decimal(0),
      cost: new Prisma.Decimal(25000),
      profit: new Prisma.Decimal(-25000),
      status: WorkOrderStatus.ai_reviewing,
      riskLevel: RiskLevel.low,
      description: '高额无附件报销',
      occurredDate: now,
      extraValues: {},
      financeOpinion: '通过',
      reviewerOpinion: '通过',
      aiSummary: null,
      bossOpinion: null,
      urgent: false,
      urgentReason: null,
      urgentTime: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      generatedRecordId: null,
      attachments: [],
      timeline
    };
    const rules: any[] = [
      {
        id: 'rule_high',
        ruleKey: 'amount_over_20000',
        ruleName: '金额超过20000',
        ruleType: 'amount_threshold',
        targetType: 'work_order',
        severity: RiskLevel.high,
        conditionJson: { threshold: 20000 },
        description: '',
        isActive: true,
        createdBy: null,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'rule_attachment',
        ruleKey: 'expense_missing_attachment',
        ruleName: '高额报销缺少附件',
        ruleType: 'missing_attachment',
        targetType: 'work_order',
        severity: RiskLevel.medium,
        conditionJson: { threshold: 1000, workOrderType: 'expense' },
        description: '',
        isActive: true,
        createdBy: null,
        createdAt: now,
        updatedAt: now
      }
    ];
    const prisma: any = {
      workOrder: {
        findUnique: jest.fn(async () => workOrder),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        update: jest.fn(async ({ data }) => {
          Object.assign(workOrder, data, { updatedAt: new Date() });
          return workOrder;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          if (workOrder.id !== where.id || workOrder.status !== where.status) return { count: 0 };
          Object.assign(workOrder, data, { updatedAt: new Date() });
          return { count: 1 };
        })
      },
      riskRule: {
        findMany: jest.fn(async () => rules.filter((rule) => rule.isActive))
      },
      ruleRunResult: {
        create: jest.fn(async ({ data }) => {
          const result = { id: `result_${results.length + 1}`, createdAt: new Date(), ...data };
          results.push(result);
          return result;
        })
      },
      aiAnomaly: {
        upsert: jest.fn(async ({ where, create, update }) => {
          const existing = anomalies.find(
            (item) => item.workOrderId === where.workOrderId_ruleId.workOrderId && item.ruleId === where.workOrderId_ruleId.ruleId
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const anomaly = { id: `anomaly_${anomalies.length + 1}`, ...create };
          anomalies.push(anomaly);
          return anomaly;
        }),
        updateMany: jest.fn(async () => ({ count: 0 }))
      },
      workOrderTimeline: {
        create: jest.fn(async ({ data }) => {
          const item = { id: `timeline_${timeline.length + 1}`, createdAt: new Date(), ...data };
          timeline.push(item);
          return item;
        })
      },
      notification: { create: jest.fn(async ({ data }) => data) },
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const auditLogs = { write: jest.fn(async () => undefined) };
    const ledgerEvents = { write: jest.fn(async () => undefined) };
    const service = new RiskRulesService(prisma, auditLogs as any, ledgerEvents as any);

    const run = await service.runForWorkOrder(workOrder.id, actor, {});
    expect(run.alreadyProcessed).toBe(false);
    expect(run.workOrder.status).toBe(WorkOrderStatus.boss_pending);
    expect(run.workOrder.riskLevel).toBe(RiskLevel.high);
    expect(run.results).toHaveLength(2);
    expect(results.every((result) => result.passed === false)).toBe(true);
    expect(anomalies).toHaveLength(2);
    expect(workOrder.aiSummary).toContain('2项异常');
    expect(auditLogs.write).toHaveBeenCalledWith(expect.anything(), actor, 'work_order.rules.run', 'work_order', workOrder.id, expect.anything(), {});
    expect(ledgerEvents.write).toHaveBeenCalledWith(expect.anything(), actor, 'work_order_rules_completed', 'work_order', workOrder.id, expect.anything());

    const repeated = await service.runForWorkOrder(workOrder.id, actor, {});
    expect(repeated.alreadyProcessed).toBe(true);
    expect(results).toHaveLength(2);
    expect(anomalies).toHaveLength(2);
  });
});
