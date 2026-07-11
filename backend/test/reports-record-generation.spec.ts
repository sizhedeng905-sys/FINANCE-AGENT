import {
  BusinessRecordStatus,
  DataRecordType,
  FieldType,
  Prisma,
  RecordSourceType,
  RiskLevel,
  SemanticType,
  UserRole,
  UserStatus,
  WorkOrderStatus,
  WorkOrderType
} from '@prisma/client';

import { ReportsService } from '../src/reports/reports.service';
import { WorkOrderRecordsService } from '../src/work-orders/work-order-records.service';

const boss = {
  id: 'boss_1',
  username: 'boss',
  name: '老板',
  role: UserRole.boss,
  department: '',
  phone: '',
  status: UserStatus.active
};

describe('phase 7 record generation and reports', () => {
  it('generates a confirmed record with typed values exactly once', async () => {
    const now = new Date();
    const project = { id: 'project_1', name: '运输项目', customerName: '客户' };
    const template = { id: 'template_1', name: '运输费用模板', recordType: DataRecordType.transport };
    const fields: any[] = [
      { id: 'tf_date', fieldId: 'field_date', defaultValue: null, field: { id: 'field_date', fieldKey: 'date', fieldName: '日期', fieldType: FieldType.date } },
      { id: 'tf_amount', fieldId: 'field_amount', defaultValue: null, field: { id: 'field_amount', fieldKey: 'amount', fieldName: '金额', fieldType: FieldType.money } },
      { id: 'tf_plate', fieldId: 'field_plate', defaultValue: null, field: { id: 'field_plate', fieldKey: 'vehiclePlate', fieldName: '车牌号', fieldType: FieldType.text } },
      { id: 'tf_file', fieldId: 'field_file', defaultValue: null, field: { id: 'field_file', fieldKey: 'attachment', fieldName: '附件', fieldType: FieldType.file } }
    ];
    const workOrder: any = {
      id: 'wo_1',
      orderNo: 'WO1',
      type: WorkOrderType.transport,
      projectId: project.id,
      projectName: project.name,
      customerName: project.customerName,
      creatorId: 'employee_1',
      creatorName: '员工',
      amount: new Prisma.Decimal(12000),
      income: new Prisma.Decimal(0),
      cost: new Prisma.Decimal(0),
      profit: new Prisma.Decimal(0),
      status: WorkOrderStatus.completed,
      riskLevel: RiskLevel.low,
      description: '运输收入',
      occurredDate: now,
      extraValues: { vehiclePlate: '沪A12345' },
      financeOpinion: '通过',
      reviewerOpinion: '通过',
      aiSummary: '正常',
      bossOpinion: '通过',
      urgent: false,
      urgentReason: null,
      urgentTime: null,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      generatedRecordId: null,
      idempotencyKey: null,
      attachments: [{ id: 'attachment_1', rawFileId: 'file_1', uploadedBy: 'employee_1', createdAt: now }],
      timeline: []
    };
    const records: any[] = [];
    const prisma: any = {
      workOrder: {
        findUnique: jest.fn(async () => workOrder),
        update: jest.fn(async ({ data }) => Object.assign(workOrder, data))
      },
      projectTemplate: {
        findFirst: jest.fn(async () => ({
          id: 'pt_1',
          projectId: project.id,
          templateId: template.id,
          customName: '运输收入',
          isActive: true,
          template: { ...template, templateFields: fields }
        }))
      },
      businessRecord: {
        findFirst: jest.fn(async ({ where }) => records.find((record) => record.sourceId === where.sourceId) ?? null),
        findUnique: jest.fn(async ({ where }) => records.find((record) => record.id === where.id) ?? null),
        create: jest.fn(async ({ data }) => {
          const values = (data.values?.create ?? []).map((value: any, index: number) => ({
            id: `value_${index + 1}`,
            recordId: 'record_1',
            valueText: null,
            valueNumber: null,
            valueDate: null,
            valueJson: null,
            createdAt: now,
            updatedAt: now,
            ...value,
            field: fields.find((item) => item.fieldId === value.fieldId)?.field
          }));
          const record = {
            id: 'record_1',
            createdAt: now,
            updatedAt: now,
            voidedAt: null,
            voidedBy: null,
            ...data,
            project,
            template,
            values
          };
          records.push(record);
          return record;
        })
      },
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const auditLogs = { write: jest.fn(async () => undefined) };
    const ledgerEvents = { write: jest.fn(async () => undefined) };
    const service = new WorkOrderRecordsService(prisma, auditLogs as any, ledgerEvents as any);

    const generated = await service.generate(workOrder.id, boss, {});
    expect(generated.status).toBe(BusinessRecordStatus.confirmed);
    expect(generated.sourceType).toBe(RecordSourceType.work_order);
    expect(generated.sourceId).toBe(workOrder.id);
    expect(generated.category).toBe('收入');
    expect(generated.values.find((item) => item.fieldName === '金额')?.value).toBe(12000);
    expect(generated.values.find((item) => item.fieldName === '车牌号')?.value).toBe('沪A12345');
    expect(generated.values.find((item) => item.fieldName === '附件')?.value).toEqual(['file_1']);
    expect(workOrder.generatedRecordId).toBe('record_1');
    expect(records).toHaveLength(1);

    const repeated = await service.generate(workOrder.id, boss, {});
    expect(repeated.id).toBe('record_1');
    expect(records).toHaveLength(1);
    expect(ledgerEvents.write).toHaveBeenCalledTimes(1);
  });

  it('derives finance, boss, and project totals from stored records', async () => {
    const now = new Date();
    const project = { id: 'project_1', name: '经营项目', customerName: '客户' };
    const base = {
      projectId: project.id,
      templateId: 'template_1',
      recordDate: now,
      sourceType: RecordSourceType.work_order,
      status: BusinessRecordStatus.confirmed,
      attachments: [],
      createdBy: 'boss',
      createdAt: now,
      updatedAt: now,
      confirmedAt: now,
      confirmedBy: '老板',
      voidedAt: null,
      voidedBy: null,
      project
    };
    const records: any[] = [
      { ...base, id: 'income_1', recordType: DataRecordType.transport, amount: new Prisma.Decimal(1000), category: '收入', subCategory: '运费', description: '', sourceId: 'wo_1' },
      { ...base, id: 'cost_1', recordType: DataRecordType.reimbursement, amount: new Prisma.Decimal(400), category: '支出', subCategory: '油费', description: '', sourceId: 'wo_2' }
    ];
    const pending = { id: 'wo_pending', orderNo: 'WO-P', projectId: project.id, projectName: project.name, amount: new Prisma.Decimal(300), riskLevel: RiskLevel.medium, urgent: false };
    const prisma: any = {
      businessRecord: { findMany: jest.fn(async () => records) },
      workOrder: {
        count: jest.fn(async ({ where }) => (where.status === WorkOrderStatus.boss_pending ? 1 : 2)),
        findMany: jest.fn(async () => [pending])
      },
      approval: {
        count: jest.fn(async ({ where }) => (where.action === 'approve' ? 1 : 0))
      },
      aiAnomaly: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [{ reason: '金额异常', workOrder: pending }])
      },
      project: { findUnique: jest.fn(async () => project) }
    };
    const service = new ReportsService(prisma);

    const finance = await service.finance({ period: 'today' });
    expect(finance.totalIncome).toBe(1000);
    expect(finance.totalExpense).toBe(400);
    expect(finance.estimatedProfit).toBe(600);
    expect(finance.expenseCategories).toEqual([{ name: '油费', amount: 400 }]);

    const bossReport = await service.boss({ period: 'daily' });
    expect(bossReport).toMatchObject({ income: 1000, expense: 400, profit: 600, pendingApprovals: 1, anomalyCount: 1 });
    const summary = await service.projectSummary(project.id);
    expect(summary).toMatchObject({ income: 1000, expense: 400, profit: 600, recordCount: 2 });
    expect(await service.pendingApprovals()).toHaveLength(1);
  });
});
