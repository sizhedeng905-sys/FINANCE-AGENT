import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { DataRecordType, Prisma, RiskLevel, UserRole, UserStatus, WorkOrderStatus, WorkOrderType } from '@prisma/client';

import { WorkOrdersService } from '../src/work-orders/work-orders.service';
import { toWorkOrder } from '../src/work-orders/work-order.presenter';
import { IdempotencyService } from '../src/idempotency/idempotency.service';

function createActor(role: UserRole, id: string = role) {
  return {
    id,
    username: role,
    name: role,
    role,
    department: '',
    phone: '',
    status: UserStatus.active,
    tokenVersion: 0
  };
}

describe('WorkOrdersService phase 4 state machine', () => {
  const project = {
    id: 'project_1',
    name: '测试项目',
    customerName: '测试客户',
    status: 'active'
  };
  let workOrders: any[];
  let approvals: any[];
  let notifications: any[];
  let timeline: any[];
  let auditLogs: { write: jest.Mock };
  let service: WorkOrdersService;

  beforeEach(() => {
    workOrders = [];
    approvals = [];
    notifications = [];
    timeline = [];
    const idempotencyRows: any[] = [];
    let counter = 0;

    const includeRelations = (workOrder: any) => ({
      ...workOrder,
      attachments: workOrder.attachments ?? [],
      timeline: timeline.filter((item) => item.workOrderId === workOrder.id)
    });
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      project: {
        findUnique: jest.fn(async ({ where }) => (where.id === project.id ? project : null))
      },
      projectTemplate: {
        findMany: jest.fn(async () => [{
          id: 'project_template_1',
          projectId: project.id,
          templateId: 'template_expense',
          recordType: DataRecordType.reimbursement,
          isActive: true,
          template: { id: 'template_expense', version: 1 }
        }])
      },
      workOrder: {
        create: jest.fn(async ({ data }) => {
          const now = new Date();
          const item = {
            id: `wo_${++counter}`,
            orderNo: data.orderNo,
            type: data.type,
            projectId: data.projectId,
            projectName: data.projectName,
            customerName: data.customerName,
            creatorId: data.creatorId,
            creatorName: data.creatorName,
            amount: new Prisma.Decimal(data.amount),
            income: new Prisma.Decimal(0),
            cost: new Prisma.Decimal(0),
            profit: new Prisma.Decimal(0),
            status: data.status,
            riskLevel: RiskLevel.low,
            description: data.description,
            occurredDate: data.occurredDate,
            extraValues: data.extraValues,
            financeOpinion: null,
            reviewerOpinion: null,
            aiSummary: null,
            bossOpinion: null,
            urgent: false,
            urgentReason: null,
            urgentTime: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            generatedRecordId: null,
            templateId: data.templateId ?? null,
            templateVersion: data.templateVersion ?? null,
            templateSnapshot: null,
            submissionSnapshot: null,
            submittedAt: null,
            version: 1,
            creationIdempotencyKey: data.creationIdempotencyKey ?? null,
            approvalIdempotencyKey: null,
            attachments: (data.attachments?.create ?? []).map((attachment: any, index: number) => ({
              id: `attachment_${index}`,
              workOrderId: `wo_${counter}`,
              rawFileId: attachment.rawFileId,
              uploadedBy: attachment.uploadedBy,
              createdAt: now
            }))
          };
          workOrders.push(item);
          if (data.timeline?.create) {
            timeline.push({
              id: `timeline_${timeline.length + 1}`,
              workOrderId: item.id,
              createdAt: now,
              fromStatus: null,
              ...data.timeline.create
            });
          }
          return includeRelations(item);
        }),
        findUnique: jest.fn(async ({ where }) => {
          const item = workOrders.find((workOrder) =>
            where.id ? workOrder.id === where.id : workOrder.creationIdempotencyKey === where.creationIdempotencyKey
          );
          return item ? includeRelations(item) : null;
        }),
        findMany: jest.fn(async ({ where }) =>
          workOrders
            .filter((item) => !where.creatorId || item.creatorId === where.creatorId)
            .map(includeRelations)
        ),
        count: jest.fn(async ({ where }) =>
          workOrders.filter((item) => !where.creatorId || item.creatorId === where.creatorId).length
        ),
        update: jest.fn(async ({ where, data }) => {
          const item = workOrders.find((workOrder) => workOrder.id === where.id);
          const normalized = { ...data };
          if (typeof data.version === 'object') normalized.version = item.version + data.version.increment;
          Object.assign(item, normalized, { updatedAt: new Date() });
          return includeRelations(item);
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const item = workOrders.find((workOrder) =>
            workOrder.id === where.id &&
            (!where.status || workOrder.status === where.status) &&
            (where.version === undefined || workOrder.version === where.version)
          );
          if (!item) return { count: 0 };
          const normalized = { ...data };
          if (typeof data.version === 'object') normalized.version = item.version + data.version.increment;
          Object.assign(item, normalized, { updatedAt: new Date() });
          return { count: 1 };
        })
      },
      workOrderTimeline: {
        create: jest.fn(async ({ data }) => {
          const item = { id: `timeline_${timeline.length + 1}`, createdAt: new Date(), ...data };
          timeline.push(item);
          return item;
        })
      },
      approval: {
        create: jest.fn(async ({ data }) => {
          const item = { id: `approval_${approvals.length + 1}`, createdAt: new Date(), ...data };
          approvals.push(item);
          return item;
        })
      },
      notification: {
        create: jest.fn(async ({ data }) => {
          const item = { id: `notification_${notifications.length + 1}`, createdAt: new Date(), ...data };
          notifications.push(item);
          return item;
        })
      },
      aiAnomaly: {
        updateMany: jest.fn(async () => ({ count: 0 }))
      },
      idempotencyKey: {
        findUnique: jest.fn(async ({ where }) => {
          const key = where.createdBy_requestMethod_requestPath_key;
          return idempotencyRows.find((item) =>
            item.createdBy === key.createdBy &&
            item.requestMethod === key.requestMethod &&
            item.requestPath === key.requestPath &&
            item.key === key.key
          ) ?? null;
        }),
        create: jest.fn(async ({ data }) => {
          const item = { id: `idempotency_${idempotencyRows.length + 1}`, status: 'processing', responseBody: null, ...data };
          idempotencyRows.push(item);
          return item;
        }),
        update: jest.fn(async ({ where, data }) => {
          const item = idempotencyRows.find((entry) => entry.id === where.id);
          Object.assign(item, data);
          return item;
        })
      }
    };
    tx.$transaction = jest.fn(async (callback) => callback(tx));
    auditLogs = { write: jest.fn(async () => undefined) };
    const riskRules = {
      runForWorkOrder: jest.fn(async (id: string) => {
        const item = workOrders.find((workOrder) => workOrder.id === id);
        const now = new Date();
        timeline.push({
          id: `timeline_${timeline.length + 1}`,
          workOrderId: id,
          operatorId: null,
          operatorName: '系统规则',
          role: 'system',
          action: '规则复核完成',
          comment: '规则复核未发现明显异常',
          fromStatus: WorkOrderStatus.ai_reviewing,
          toStatus: WorkOrderStatus.boss_pending,
          createdAt: now
        });
        Object.assign(item, {
          status: WorkOrderStatus.boss_pending,
          riskLevel: RiskLevel.low,
          aiSummary: '规则复核未发现明显异常',
          updatedAt: now
        });
        return { workOrder: toWorkOrder(includeRelations(item)) };
      })
    };
    const workOrderRecords = {
      prepareSubmission: jest.fn(async () => ({
        template: { id: 'template_expense', version: 1 },
        recordType: DataRecordType.reimbursement,
        values: [],
        templateSnapshot: { templateId: 'template_expense', version: 1 },
        submissionSnapshot: { templateId: 'template_expense', version: 1 }
      })),
      createWithinTransaction: jest.fn(async () => ({ id: 'business_record_1' })),
      generate: jest.fn(async () => ({ id: 'business_record_1' }))
    };
    service = new WorkOrdersService(
      tx,
      auditLogs as any,
      riskRules as any,
      workOrderRecords as any,
      new IdempotencyService()
    );
  });

  async function createDraft(employeeId = 'employee') {
    return service.create(
      {
        type: WorkOrderType.expense,
        projectId: project.id,
        amount: '1200.00',
        description: '测试报销',
        occurredDate: '2026-07-11'
      },
      createActor(UserRole.employee, employeeId),
      {},
      `create-${employeeId}`
    );
  }

  async function createOrder(employeeId = 'employee') {
    const draft = await createDraft(employeeId);
    return service.submit(draft.id, createActor(UserRole.employee, employeeId), {});
  }

  it('creates a draft, submits it, and scopes employee lists to token user', async () => {
    const draft = await createDraft('employee_1');
    expect(draft.status).toBe(WorkOrderStatus.draft);
    expect(draft.timeline).toHaveLength(1);
    expect(notifications).toHaveLength(0);

    const first = await service.submit(draft.id, createActor(UserRole.employee, 'employee_1'), {});
    await createOrder('employee_2');

    expect(first.status).toBe(WorkOrderStatus.finance_reviewing);
    expect(first.timeline).toHaveLength(2);
    expect(notifications[0].targetRole).toBe(UserRole.finance);

    const list = await service.findMany({}, createActor(UserRole.employee, 'employee_1'));
    expect(list.total).toBe(1);
    expect(list.items[0].creatorId).toBe('employee_1');
  });

  it('runs finance, reviewer, rule, and boss transitions with approvals and audit logs', async () => {
    const created = await createOrder();
    const finance = await service.financeReview(
      created.id,
      { action: 'approve', comment: '财务通过' },
      createActor(UserRole.finance),
      {}
    );
    expect(finance.status).toBe(WorkOrderStatus.reviewer_reviewing);

    const reviewed = await service.reviewerReview(
      created.id,
      { action: 'approve', comment: '复核通过' },
      createActor(UserRole.reviewer),
      {}
    );
    expect(reviewed.status).toBe(WorkOrderStatus.boss_pending);

    const completed = await service.bossApprove(
      created.id,
      { action: 'approve', comment: '老板通过' },
      createActor(UserRole.boss),
      {},
      'boss-approve-key'
    );
    expect(completed.status).toBe(WorkOrderStatus.completed);
    expect(completed.generatedRecordId).toBe('business_record_1');
    expect(approvals).toHaveLength(3);
    expect(timeline).toHaveLength(6);
    expect(auditLogs.write).toHaveBeenCalledTimes(5);

    const repeated = await service.bossApprove(
      created.id,
      { action: 'approve', comment: '老板通过' },
      createActor(UserRole.boss),
      {},
      'boss-approve-key'
    );
    expect(repeated.generatedRecordId).toBe('business_record_1');
    expect(approvals).toHaveLength(3);
    await expect(service.bossApprove(
      created.id,
      { action: 'reject', comment: '改变审批动作' },
      createActor(UserRole.boss),
      {},
      'boss-approve-key'
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects illegal transitions and limits urges to once per 30 minutes', async () => {
    const created = await createOrder();
    await expect(
      service.reviewerReview(created.id, { action: 'approve' }, createActor(UserRole.reviewer), {})
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    const urged = await service.urge(created.id, { reason: '请尽快处理' }, createActor(UserRole.employee), {});
    expect(urged.urgent).toBe(true);
    await expect(
      service.urge(created.id, { reason: '再次催办' }, createActor(UserRole.employee), {})
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
