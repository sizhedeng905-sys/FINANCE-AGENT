import {
  AccountingDirection,
  BusinessRecordStatus,
  DataRecordType,
  FieldType,
  FileScanStatus,
  Prisma,
  ProjectStatus,
  RecordDataLayer,
  RecordSourceType,
  RiskLevel,
  SemanticType,
  UserRole,
  UserStatus,
  WorkOrderStatus,
  WorkOrderType
} from '@prisma/client';

import { ReportsService } from '../src/reports/reports.service';
import { dayRange, reportRange, shiftMonthDate } from '../src/reports/report-period';
import { RecordPolicyService } from '../src/record-policy/record-policy.service';
import { WorkOrderRecordsService } from '../src/work-orders/work-order-records.service';

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

describe('phase 7 record generation and reports', () => {
  it('uses strict Asia/Shanghai day, week, and month boundaries', () => {
    const day = reportRange('today', '2026-07-11');
    expect(day.start.toISOString()).toBe('2026-07-10T16:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-07-11T16:00:00.000Z');
    expect(day).toMatchObject({ startDate: '2026-07-11', endDate: '2026-07-11' });

    const week = reportRange('week', '2026-07-12');
    expect(week.start.toISOString()).toBe('2026-07-05T16:00:00.000Z');
    expect(week.end.toISOString()).toBe('2026-07-12T16:00:00.000Z');
    expect(week).toMatchObject({ startDate: '2026-07-06', endDate: '2026-07-12' });

    const month = reportRange('month', '2026-07-31');
    expect(month.start.toISOString()).toBe('2026-06-30T16:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-07-31T16:00:00.000Z');
    expect(() => dayRange('2026-02-30')).toThrow('日期无效');
    expect(shiftMonthDate('2026-01-31', -1)).toBe('2025-12-01');
  });

  it('generates a confirmed record with typed values exactly once', async () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    const project = { id: 'project_1', name: '运输项目', customerName: '客户', status: ProjectStatus.active };
    const template = {
      id: 'template_1',
      name: '报销工单模板',
      recordType: DataRecordType.reimbursement,
      accountingDirection: AccountingDirection.expense,
      dataLayer: RecordDataLayer.actual as RecordDataLayer,
      primaryAmountFieldId: 'field_amount',
      primaryDateFieldId: 'field_date',
      version: 1
    };
    const fields: any[] = [
      { id: 'tf_date', fieldId: 'field_date', defaultValue: null, isRequired: true, isVisible: true, displayOrder: 1, field: { id: 'field_date', fieldKey: 'date', fieldName: '日期', fieldType: FieldType.date, isActive: true } },
      { id: 'tf_amount', fieldId: 'field_amount', defaultValue: null, isRequired: true, isVisible: true, displayOrder: 2, field: { id: 'field_amount', fieldKey: 'amount', fieldName: '金额', fieldType: FieldType.money, isActive: true } },
      { id: 'tf_category', fieldId: 'field_category', defaultValue: null, isRequired: true, isVisible: true, displayOrder: 3, field: { id: 'field_category', fieldKey: 'costCategory', fieldName: '成本分类', fieldType: FieldType.select, isActive: true } },
      { id: 'tf_file', fieldId: 'field_file', defaultValue: null, isRequired: false, isVisible: true, displayOrder: 4, field: { id: 'field_file', fieldKey: 'attachment', fieldName: '附件', fieldType: FieldType.file, isActive: true } }
    ];
    const workOrder: any = {
      id: 'wo_1',
      orderNo: 'WO1',
      type: WorkOrderType.expense,
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
      description: '费用报销',
      occurredDate: now,
      extraValues: { expenseType: '人工' },
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
      templateId: template.id,
      templateVersion: template.version,
      templateSnapshot: {},
      submissionSnapshot: {},
      submittedAt: now,
      version: 1,
      idempotencyKey: null,
      attachments: [{
        id: 'attachment_1',
        rawFileId: 'file_1',
        uploadedBy: 'employee_1',
        createdAt: now,
        rawFile: {
          id: 'file_1',
          isVoided: false,
          scanStatus: FileScanStatus.clean,
          sha256: 'a'.repeat(64),
          fileSize: 128n
        }
      }],
      timeline: []
    };
    const records: any[] = [];
    const prisma: any = {
      workOrder: {
        findUnique: jest.fn(async () => workOrder),
        update: jest.fn(async ({ data }) => {
          const normalized = { ...data };
          if (typeof data.version === 'object') normalized.version = workOrder.version + data.version.increment;
          return Object.assign(workOrder, normalized);
        })
      },
      projectTemplate: {
        findUnique: jest.fn(async () => ({
          id: 'pt_1',
          projectId: project.id,
          templateId: template.id,
          recordType: template.recordType,
          customName: '运输收入',
          isActive: true,
          template: { ...template, templateFields: fields }
        }))
      },
      project: { findUnique: jest.fn(async () => project) },
      template: { findUnique: jest.fn(async () => ({ ...template, templateFields: fields })) },
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
      $executeRaw: jest.fn(async () => 0),
      $transaction: jest.fn(async (callback) => callback(prisma))
    };
    const auditLogs = { write: jest.fn(async () => undefined) };
    const ledgerEvents = { write: jest.fn(async () => undefined) };
    const service = new WorkOrderRecordsService(
      prisma,
      auditLogs as any,
      ledgerEvents as any,
      new RecordPolicyService()
    );

    template.dataLayer = RecordDataLayer.budget;
    await expect(service.generate(workOrder.id, boss, {})).rejects.toThrow('工单只能使用实际经营数据层模板');
    expect(records).toHaveLength(0);
    template.dataLayer = RecordDataLayer.actual;

    const generated = await service.generate(workOrder.id, boss, {});
    expect(generated.status).toBe(BusinessRecordStatus.confirmed);
    expect(generated.sourceType).toBe(RecordSourceType.work_order);
    expect(generated.sourceId).toBe(workOrder.id);
    expect(generated.category).toBe('成本');
    expect(generated.values.find((item) => item.fieldName === '金额')?.value).toBe('12000.00');
    expect(generated.values.find((item) => item.fieldName === '成本分类')?.value).toBe('人工');
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
      dataLayer: RecordDataLayer.actual,
      voidedAt: null,
      voidedBy: null,
      project
    };
    const records: any[] = [
      { ...base, id: 'income_1', recordType: DataRecordType.revenue, accountingDirection: AccountingDirection.income, amount: new Prisma.Decimal(1000), category: '收入', subCategory: '运费', description: '', sourceId: 'wo_1' },
      { ...base, id: 'cost_1', recordType: DataRecordType.reimbursement, accountingDirection: AccountingDirection.expense, amount: new Prisma.Decimal(400), category: '成本', subCategory: '油费', description: '', sourceId: 'wo_2' },
      { ...base, id: 'draft_1', status: BusinessRecordStatus.draft, recordType: DataRecordType.revenue, accountingDirection: AccountingDirection.income, amount: new Prisma.Decimal(9000), category: '收入', subCategory: '未确认收入', description: '', sourceId: 'manual' },
      { ...base, id: 'void_1', status: BusinessRecordStatus.rejected, recordType: DataRecordType.reimbursement, accountingDirection: AccountingDirection.expense, amount: new Prisma.Decimal(8000), category: '成本', subCategory: '已作废成本', description: '', sourceId: 'manual' },
      { ...base, id: 'reconciliation_1', dataLayer: RecordDataLayer.reconciliation, recordType: DataRecordType.revenue, accountingDirection: AccountingDirection.income, amount: new Prisma.Decimal(99999), category: '收入', subCategory: '对账收入', description: '', sourceId: 'manual-reconciliation' }
    ];
    const pending = { id: 'wo_pending', orderNo: 'WO-P', projectId: project.id, projectName: project.name, amount: new Prisma.Decimal(300), riskLevel: RiskLevel.medium, urgent: false };
    const prisma: any = {
      businessRecord: {
        findMany: jest.fn(async ({ where }) => records.filter((record) =>
          (!where?.status || record.status === where.status)
          && (!where?.dataLayer || record.dataLayer === where.dataLayer)
        )),
        count: jest.fn(async ({ where }) => records.filter((record) =>
          (!where?.status || record.status === where.status)
          && (!where?.dataLayer || record.dataLayer === where.dataLayer)
        ).length)
      },
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
    expect(finance.totalIncome).toBe('1000.00');
    expect(finance.totalExpense).toBe('400.00');
    expect(finance.estimatedProfit).toBe('600.00');
    expect(finance.expenseCategories).toEqual([{ name: '油费', amount: '400.00', recordCount: 1, percentage: 1 }]);

    const bossReport = await service.boss({ period: 'daily' });
    expect(bossReport).toMatchObject({ income: '1000.00', expense: '400.00', profit: '600.00', pendingApprovals: 1, anomalyCount: 1 });
    const summary = await service.projectSummary(project.id);
    expect(summary).toMatchObject({ income: '1000.00', expense: '400.00', profit: '600.00', recordCount: 2 });
    expect(prisma.businessRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: BusinessRecordStatus.confirmed,
        dataLayer: RecordDataLayer.actual
      })
    }));
    expect(await service.pendingApprovals()).toHaveLength(1);
  });

  it('computes month comparisons from report values without model arithmetic', async () => {
    const service = new ReportsService({} as any);
    const report = (startDate: string, endDate: string, income: string, expense: string, profit: string) => ({
      range: { startDate, endDate, timezone: 'Asia/Shanghai' },
      income,
      expense,
      profit,
      recordCount: 2
    });
    const boss = jest.spyOn(service, 'boss')
      .mockResolvedValueOnce(report('2026-07-01', '2026-07-31', '1200.00', '450.00', '750.00') as any)
      .mockResolvedValueOnce(report('2026-06-01', '2026-06-30', '1000.00', '450.00', '550.00') as any);

    const comparison = await service.bossComparison('month_over_month', '2026-07-15');
    expect(boss).toHaveBeenNthCalledWith(1, { period: 'monthly', date: '2026-07-15' });
    expect(boss).toHaveBeenNthCalledWith(2, { period: 'monthly', date: '2026-06-01' });
    expect(comparison).toMatchObject({
      kind: 'month_over_month',
      changes: {
        income: { delta: '200.00', rate: '0.2' },
        expense: { delta: '0.00', rate: '0' },
        profit: { delta: '200.00', rate: '0.3636' }
      }
    });
  });
});
