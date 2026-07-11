import { UnprocessableEntityException } from '@nestjs/common';
import { RiskLevel, UserRole, UserStatus, WorkOrderStatus, WorkOrderType } from '@prisma/client';

import { WorkOrdersService } from '../src/work-orders/work-orders.service';

function createActor(role: UserRole, id: string = role) {
  return {
    id,
    username: role,
    name: role,
    role,
    department: '',
    phone: '',
    status: UserStatus.active
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
    let counter = 0;

    const includeRelations = (workOrder: any) => ({
      ...workOrder,
      attachments: workOrder.attachments ?? [],
      timeline: timeline.filter((item) => item.workOrderId === workOrder.id)
    });
    const tx: any = {
      project: {
        findUnique: jest.fn(async ({ where }) => (where.id === project.id ? project : null))
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
            amount: data.amount,
            income: 0,
            cost: 0,
            profit: 0,
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
          const item = workOrders.find((workOrder) => workOrder.id === where.id);
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
          Object.assign(item, data, { updatedAt: new Date() });
          return includeRelations(item);
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
      }
    };
    tx.$transaction = jest.fn(async (callback) => callback(tx));
    auditLogs = { write: jest.fn(async () => undefined) };
    service = new WorkOrdersService(tx, auditLogs as any);
  });

  async function createOrder(employeeId = 'employee') {
    return service.create(
      {
        type: WorkOrderType.expense,
        projectId: project.id,
        amount: 1200,
        description: '测试报销',
        occurredDate: '2026-07-11',
        attachments: ['file_1']
      },
      createActor(UserRole.employee, employeeId),
      {}
    );
  }

  it('creates directly in finance_reviewing and scopes employee lists to token user', async () => {
    const first = await createOrder('employee_1');
    await createOrder('employee_2');

    expect(first.status).toBe(WorkOrderStatus.finance_reviewing);
    expect(first.timeline).toHaveLength(1);
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
    expect(reviewed.status).toBe(WorkOrderStatus.ai_reviewing);

    const aiReviewed = await service.aiReview(created.id, createActor(UserRole.finance), {});
    expect(aiReviewed.status).toBe(WorkOrderStatus.boss_pending);

    const completed = await service.bossApprove(
      created.id,
      { action: 'approve', comment: '老板通过' },
      createActor(UserRole.boss),
      {}
    );
    expect(completed.status).toBe(WorkOrderStatus.completed);
    expect(approvals).toHaveLength(3);
    expect(timeline).toHaveLength(5);
    expect(auditLogs.write).toHaveBeenCalledTimes(5);
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
