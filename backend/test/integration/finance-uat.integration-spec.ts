import {
  AccountingDirection,
  BusinessRecordStatus,
  Prisma,
  PrismaClient,
  RecordDataLayer,
  RecordSourceType
} from '@prisma/client';

import {
  buildFinanceUatReport,
  collectFinanceUatSnapshot,
  createBlankFinanceUatManifest
} from '../../scripts/finance-uat-lib';

describe('B8-08 finance UAT PostgreSQL reconciliation', () => {
  const prisma = new PrismaClient();

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    if (!databaseName.endsWith('_test')) throw new Error('Finance UAT integration refuses a non-test database.');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('collects only selected financial facts and reconciles audit/ledger coverage by cents', async () => {
    const [project, template, finance] = await Promise.all([
      prisma.project.findFirstOrThrow({ orderBy: { createdAt: 'asc' } }),
      prisma.template.findFirstOrThrow({ orderBy: { createdAt: 'asc' } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'finance' } })
    ]);
    const marker = `uat-${Date.now()}`;
    const record = await prisma.businessRecord.create({
      data: {
        projectId: project.id,
        templateId: template.id,
        recordType: 'revenue',
        accountingDirection: AccountingDirection.income,
        dataLayer: RecordDataLayer.actual,
        recordDate: new Date('2026-07-01T00:00:00.000Z'),
        amount: new Prisma.Decimal('12.34'),
        sourceType: RecordSourceType.manual,
        sourceId: marker,
        status: BusinessRecordStatus.confirmed,
        createdBy: finance.id,
        confirmedBy: finance.id,
        confirmedAt: new Date('2026-07-01T00:00:00.000Z')
      }
    });
    const audit = await prisma.auditLog.create({
      data: {
        actorUserId: finance.id,
        actorUsername: finance.username,
        action: 'uat.synthetic_reconciliation',
        resourceType: 'business_record',
        resourceId: record.id
      }
    });
    const ledger = await prisma.ledgerEvent.create({
      data: {
        eventType: 'uat_synthetic_reconciliation',
        aggregateType: 'business_record',
        aggregateId: record.id,
        actorUserId: finance.id,
        actorUsername: finance.username,
        idempotencyKey: `${marker}:ledger`
      }
    });

    try {
      const manifest = createBlankFinanceUatManifest('B8-08-UAT-INTEGRATION');
      const testCase = manifest.cases.find((item) => item.id === 'UAT-05')!;
      testCase.recordIds = [record.id];
      testCase.expected = {
        ...testCase.expected,
        recordCount: 1,
        invalidRecordCount: 0,
        income: '12.34',
        expense: '0.00',
        profit: '12.34',
        auditCoveredRecordCount: 1,
        ledgerCoveredRecordCount: 1,
        exactDuplicateSourceGroups: 0
      };

      const snapshot = await collectFinanceUatSnapshot(prisma, manifest);
      const report = buildFinanceUatReport(manifest, snapshot);
      expect(snapshot.records).toEqual([
        expect.objectContaining({ id: record.id, amount: '12.34', accountingDirection: 'income' })
      ]);
      expect(report.cases.find((item) => item.id === 'UAT-05')).toMatchObject({
        status: 'passed',
        actual: { income: '12.34', expense: '0.00', profit: '12.34' },
        untrackedFailure: false
      });
      expect(report.humanGateStatus).toBe('external_unverified');
    } finally {
      await prisma.ledgerEvent.delete({ where: { id: ledger.id } });
      await prisma.auditLog.delete({ where: { id: audit.id } });
      await prisma.businessRecord.delete({ where: { id: record.id } });
    }
  });
});
