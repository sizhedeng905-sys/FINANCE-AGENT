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
  it('persists financial thresholds from canonical decimal strings without a number round-trip', async () => {
    const now = new Date('2026-07-18T00:00:00.000Z');
    const create = jest.fn(async ({ data }) => ({
      id: 'rule_decimal_string',
      ...data,
      createdAt: now,
      updatedAt: now
    }));
    const prisma: any = {
      riskRule: { create },
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const service = new RiskRulesService(
      prisma,
      { write: jest.fn(async () => undefined) } as any,
      { write: jest.fn(async () => undefined) } as any
    );

    const result = await service.create({
      ruleKey: 'decimal_string_threshold',
      ruleName: '字符串金额阈值',
      ruleType: 'amount_threshold',
      severity: RiskLevel.medium,
      conditionJson: { threshold: '0.1' }
    }, actor, {});

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conditionJson: { threshold: '0.10' } })
    }));
    expect(result).toMatchObject({
      conditionJson: { threshold: '0.10' },
      compatibilityWarnings: []
    });
  });

  it('rejects a legacy numeric threshold that has already lost decimal precision', async () => {
    const create = jest.fn();
    const prisma: any = {
      riskRule: { create },
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const service = new RiskRulesService(
      prisma,
      { write: jest.fn(async () => undefined) } as any,
      { write: jest.fn(async () => undefined) } as any
    );
    const unsafeThreshold = JSON.parse('99999999999999.99') as number;
    expect(unsafeThreshold.toString()).toBe('99999999999999.98');

    await expect(service.create({
      ruleKey: 'unsafe_numeric_threshold',
      ruleName: '不安全数字阈值',
      ruleType: 'amount_threshold',
      severity: RiskLevel.medium,
      conditionJson: { threshold: unsafeThreshold }
    }, actor, {})).rejects.toMatchObject({
      status: 400,
      response: {
        data: { reason: 'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE' }
      }
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('persists an explicit zero-day default and rejects windows beyond the supported boundary', async () => {
    const now = new Date('2026-07-18T00:00:00.000Z');
    const create = jest.fn(async ({ data }) => ({
      id: 'rule_zero_day',
      ...data,
      createdAt: now,
      updatedAt: now
    }));
    const prisma: any = {
      riskRule: { create },
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const service = new RiskRulesService(
      prisma,
      { write: jest.fn(async () => undefined) } as any,
      { write: jest.fn(async () => undefined) } as any
    );
    const base = {
      ruleKey: 'duplicate_zero_day',
      ruleName: '零天重复候选',
      ruleType: 'duplicate_submission' as const,
      severity: RiskLevel.medium,
      description: '仅生成候选'
    };

    await service.create({ ...base, conditionJson: {} }, actor, {});
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conditionJson: { windowDays: 0 } })
    }));
    await expect(service.create({
      ...base,
      ruleKey: 'duplicate_too_wide',
      conditionJson: { windowDays: 366 }
    }, actor, {})).rejects.toThrow('windowDays');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('applies duplicate_submission.windowDays to the candidate search boundary and evidence', async () => {
    const occurredDate = new Date('2026-01-01T00:00:00.000Z');
    const candidateDate = new Date('2025-12-30T00:00:00.000Z');
    const findFirst = jest.fn(async () => ({
      id: 'wo_candidate',
      orderNo: 'WO-CANDIDATE',
      creatorId: 'employee_2',
      occurredDate: candidateDate,
      amount: new Prisma.Decimal('100.00'),
      extraValues: {},
      attachments: []
    }));
    const service = new RiskRulesService(
      { workOrder: { findFirst } } as any,
      { write: jest.fn() } as any,
      { write: jest.fn() } as any
    );
    const evaluation = await (service as unknown as {
      evaluate: (rule: any, workOrder: any) => Promise<any>;
    }).evaluate(
      {
        id: 'rule_duplicate_window',
        ruleKey: 'duplicate_window',
        ruleName: '重复候选时间窗',
        ruleType: 'duplicate_submission',
        targetType: 'work_order',
        severity: RiskLevel.medium,
        conditionJson: { windowDays: 2 },
        description: '',
        isActive: true,
        createdBy: null,
        createdAt: occurredDate,
        updatedAt: occurredDate
      },
      {
        id: 'wo_current',
        orderNo: 'WO-CURRENT',
        projectId: 'project_1',
        creatorId: 'employee_1',
        amount: new Prisma.Decimal('100.00'),
        occurredDate,
        extraValues: {},
        attachments: []
      }
    );

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        occurredDate: {
          gte: new Date('2025-12-30T00:00:00.000Z'),
          lt: new Date('2026-01-04T00:00:00.000Z')
        }
      })
    }));
    expect(evaluation).toMatchObject({
      hit: true,
      evidence: {
        candidateOnly: true,
        policyStatus: 'pending_human_decision',
        windowDays: 2,
        windowStartInclusive: '2025-12-30T00:00:00.000Z',
        windowEndExclusive: '2026-01-04T00:00:00.000Z',
        matchedDayOffset: -2
      }
    });
  });

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
      submittedAt: now,
      updatedAt: now,
      version: 1,
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
          const normalized = { ...data };
          if (typeof data.version === 'object') normalized.version = workOrder.version + data.version.increment;
          Object.assign(workOrder, normalized, { updatedAt: new Date() });
          return workOrder;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          if (
            workOrder.id !== where.id ||
            workOrder.status !== where.status ||
            (where.version !== undefined && workOrder.version !== where.version)
          ) return { count: 0 };
          const normalized = { ...data };
          if (typeof data.version === 'object') normalized.version = workOrder.version + data.version.increment;
          Object.assign(workOrder, normalized, { updatedAt: new Date() });
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
      $executeRaw: jest.fn(async () => 0),
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
