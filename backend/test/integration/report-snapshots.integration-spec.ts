import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AccountingDirection,
  BusinessRecordStatus,
  DataRecordType,
  Prisma,
  RecordDataLayer,
  RecordSourceType,
  ReportSnapshotType
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AiProviderService } from '../../src/ai/ai-provider.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

jest.setTimeout(120_000);

describe('ReportSnapshot PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let provider: AiProviderService;
  let originalReportMode: unknown;
  let originalKillSwitch: unknown;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    if (!databaseName.endsWith('_test')) {
      throw new Error(`Refusing to run integration tests against non-test database "${databaseName}".`);
    }
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    provider = app.get(AiProviderService);
    originalReportMode = config.get('ai.reportMode');
    originalKillSwitch = config.get('ai.globalKillSwitch');
  });

  afterAll(async () => {
    if (config) {
      config.set('ai.reportMode', originalReportMode);
      config.set('ai.globalKillSwitch', originalKillSwitch);
    }
    if (app) await app.close();
  });

  it('freezes confirmed actual facts, separates currencies, grounds AI claims, and rejects mutation', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [bossLogin, employeeLogin] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: '123456' }).expect(200),
      request(app.getHttpServer()).post('/api/auth/login').send({ username: 'employee', password: '123456' }).expect(200)
    ]);
    const bossToken = bossLogin.body.data.accessToken as string;
    const employeeToken = employeeLogin.body.data.accessToken as string;
    const boss = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } });
    const project = await prisma.project.create({
      data: {
        name: `report-project-${suffix}`,
        customerName: 'Synthetic customer',
        ownerName: 'Synthetic owner',
        createdBy: boss.id
      }
    });
    const template = await prisma.template.create({
      data: {
        name: `report-template-${suffix}`,
        recordType: DataRecordType.other,
        createdBy: boss.id
      }
    });
    const recordDate = new Date('2042-03-14T20:00:00.000Z');
    const base = {
      projectId: project.id,
      templateId: template.id,
      recordType: DataRecordType.other,
      recordDate,
      sourceType: RecordSourceType.manual,
      createdBy: boss.id
    };
    await prisma.businessRecord.createMany({
      data: [
        {
          ...base,
          accountingDirection: AccountingDirection.income,
          amount: new Prisma.Decimal('1000.10'),
          currency: 'CNY',
          sourceId: `report-cny-income-${suffix}`,
          status: BusinessRecordStatus.confirmed,
          dataLayer: RecordDataLayer.actual,
          confirmedAt: recordDate,
          confirmedBy: boss.id
        },
        {
          ...base,
          accountingDirection: AccountingDirection.expense,
          amount: new Prisma.Decimal('400.05'),
          currency: 'CNY',
          sourceId: `report-cny-cost-${suffix}`,
          status: BusinessRecordStatus.confirmed,
          dataLayer: RecordDataLayer.actual,
          confirmedAt: recordDate,
          confirmedBy: boss.id
        },
        {
          ...base,
          accountingDirection: AccountingDirection.income,
          amount: new Prisma.Decimal('7.25'),
          currency: 'USD',
          sourceId: `report-usd-income-${suffix}`,
          status: BusinessRecordStatus.confirmed,
          dataLayer: RecordDataLayer.actual,
          confirmedAt: recordDate,
          confirmedBy: boss.id
        },
        {
          ...base,
          accountingDirection: AccountingDirection.income,
          amount: new Prisma.Decimal('99999.99'),
          currency: 'CNY',
          sourceId: `report-draft-${suffix}`,
          status: BusinessRecordStatus.draft,
          dataLayer: RecordDataLayer.actual
        },
        {
          ...base,
          accountingDirection: AccountingDirection.income,
          amount: new Prisma.Decimal('88888.88'),
          currency: 'CNY',
          sourceId: `report-reconciliation-${suffix}`,
          status: BusinessRecordStatus.confirmed,
          dataLayer: RecordDataLayer.reconciliation,
          confirmedAt: recordDate,
          confirmedBy: boss.id
        }
      ]
    });

    await request(app.getHttpServer())
      .post('/api/reports/snapshots')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-15', projectIds: [project.id] })
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/api/reports/snapshots')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-15', projectIds: [project.id] })
      .expect(201);
    const result = created.body.data;
    expect(result).toMatchObject({ reused: false, sourceCount: 3 });
    expect(result.snapshot.metrics).toMatchObject({
      currency: null,
      income: null,
      cost: null,
      profit: null,
      recordCount: 3,
      byCurrency: [
        { currency: 'CNY', income: '1000.10', cost: '400.05', profit: '600.05', recordCount: 2 },
        { currency: 'USD', income: '7.25', cost: '0.00', profit: '7.25', recordCount: 1 }
      ]
    });
    expect(result.snapshot.warnings.map((item: { code: string }) => item.code)).toEqual([
      'MIXED_CURRENCY_TOTAL_DISABLED',
      'FORMAL_METRIC_POLICY_PENDING'
    ]);
    expect(result.snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.snapshot.sourceDigest).toMatch(/^[a-f0-9]{64}$/);

    const sources = await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);
    expect(sources.body.data).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(sources.body.data.items).toHaveLength(2);
    expect(sources.body.data.items.every((item: { recordHash: string }) => /^[a-f0-9]{64}$/.test(item.recordHash))).toBe(true);

    const repeated = await request(app.getHttpServer())
      .post('/api/reports/snapshots')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-15', projectIds: [project.id] })
      .expect(201);
    expect(repeated.body.data).toMatchObject({ reused: true, sourceCount: 3 });
    expect(repeated.body.data.snapshot.snapshotId).toBe(result.snapshot.snapshotId);
    expect(repeated.body.data.snapshot.snapshotHash).toBe(result.snapshot.snapshotHash);

    config.set('ai.globalKillSwitch', false);
    config.set('ai.reportMode', 'disabled');
    const disabled = await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${result.snapshot.snapshotId}/narrative`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .expect(201);
    expect(disabled.body.data).toMatchObject({ status: 'disabled', reasonCode: 'AI_DISABLED' });
    expect(await prisma.reportNarrative.count({ where: { snapshotId: result.snapshot.snapshotId } })).toBe(0);

    config.set('ai.reportMode', 'suggest');
    const generated = await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${result.snapshot.snapshotId}/narrative`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .expect(201);
    expect(generated.body.data.status).toBe('needs_finance_review');
    expect(generated.body.data.narrative).toMatchObject({
      snapshotId: result.snapshot.snapshotId,
      snapshotHash: result.snapshot.snapshotHash,
      provider: 'mock',
      decision: 'NEEDS_FINANCE_REVIEW'
    });
    const warningClaims = generated.body.data.narrative.claims.filter(
      (claim: { claimType: string }) => claim.claimType === 'WARNING'
    );
    expect(warningClaims).toHaveLength(result.snapshot.warnings.length);
    expect(generated.body.data.narrative.claims.every(
      (claim: { sourceValueHash: string }) => /^[a-f0-9]{64}$/.test(claim.sourceValueHash)
    )).toBe(true);

    const generatedAgain = await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${result.snapshot.snapshotId}/narrative`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .expect(201);
    expect(generatedAgain.body.data.narrative.id).toBe(generated.body.data.narrative.id);
    expect(await prisma.reportNarrative.count({ where: { snapshotId: result.snapshot.snapshotId } })).toBe(1);

    const firstNarrative = await prisma.reportNarrative.findUniqueOrThrow({
      where: { id: generated.body.data.narrative.id }
    });
    const upgradedTask = await prisma.aiTask.create({
      data: {
        taskType: 'report_narrative',
        resourceType: 'report_snapshot',
        resourceId: result.snapshot.snapshotId,
        inputHash: 'c'.repeat(64),
        correlationId: `report-version-${suffix}`,
        createdBy: boss.id
      }
    });
    await prisma.reportNarrative.create({
      data: {
        snapshotId: firstNarrative.snapshotId,
        aiTaskId: upgradedTask.id,
        schemaVersion: firstNarrative.schemaVersion,
        title: firstNarrative.title,
        summary: firstNarrative.summary,
        warningPaths: firstNarrative.warningPaths as Prisma.InputJsonValue,
        decision: firstNarrative.decision,
        narrativeHash: firstNarrative.narrativeHash,
        narrativeJson: firstNarrative.narrativeJson as Prisma.InputJsonValue,
        provider: firstNarrative.provider,
        modelName: `${firstNarrative.modelName}-upgraded`,
        promptVersion: 'report_narrative:v-next',
        versionVectorHash: 'd'.repeat(64),
        createdBy: boss.id
      }
    });
    expect(await prisma.reportNarrative.count({ where: { snapshotId: result.snapshot.snapshotId } })).toBe(2);

    await expect(prisma.reportSnapshot.update({
      where: { id: result.snapshot.snapshotId },
      data: { queryVersion: 'tampered' }
    })).rejects.toThrow('immutable report audit rows');

    const attackDate = new Date('2042-03-15T20:00:00.000Z');
    await prisma.businessRecord.create({
      data: {
        ...base,
        recordDate: attackDate,
        accountingDirection: AccountingDirection.income,
        amount: new Prisma.Decimal('10.00'),
        currency: 'CNY',
        sourceId: `report-attack-${suffix}`,
        status: BusinessRecordStatus.confirmed,
        dataLayer: RecordDataLayer.actual,
        confirmedAt: attackDate,
        confirmedBy: boss.id
      }
    });
    const attackSnapshot = await request(app.getHttpServer())
      .post('/api/reports/snapshots')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-16', projectIds: [project.id] })
      .expect(201);
    const attack = attackSnapshot.body.data.snapshot;
    const providerSpy = jest.spyOn(provider, 'generate').mockImplementationOnce(async (providerRequest) => {
      await providerRequest.beforeProviderRequest?.();
      return {
        text: JSON.stringify({
          schemaVersion: 'report-narrative/1.0',
          snapshotId: attack.snapshotId,
          title: '经营日报',
          summary: '本期确认记录共 2 条。',
          claims: [
            {
              claimId: 'record-count',
              claimType: 'COUNT',
              text: '本期确认记录共 2 条。',
              sourcePath: '/metrics/recordCount',
              value: '2'
            },
            {
              claimId: 'warning-1',
              claimType: 'WARNING',
              text: attack.warnings[0].message,
              sourcePath: '/warnings/0/message',
              value: attack.warnings[0].message
            }
          ],
          warningPaths: ['/warnings/0'],
          decision: 'NEEDS_FINANCE_REVIEW'
        }),
        inputTokens: 1,
        outputTokens: 1,
        raw: { syntheticAttack: true }
      };
    });
    const rejected = await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${attack.snapshotId}/narrative`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .expect(201);
    providerSpy.mockRestore();
    expect(rejected.body.data).toMatchObject({ status: 'failed', reasonCode: 'AI_SUGGESTION_FAILED' });
    expect(await prisma.reportNarrative.count({ where: { snapshotId: attack.snapshotId } })).toBe(0);
  });
});
