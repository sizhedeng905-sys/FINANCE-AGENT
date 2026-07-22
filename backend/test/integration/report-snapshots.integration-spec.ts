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
  ReportNarrativeReviewCommand,
  ReportNarrativeReviewStatus,
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
  let originalNarrativeReviewMode: unknown;

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
    originalNarrativeReviewMode = config.get('reportNarrativeReview.mode');
  });

  afterAll(async () => {
    if (config) {
      config.set('ai.reportMode', originalReportMode);
      config.set('ai.globalKillSwitch', originalKillSwitch);
      config.set('reportNarrativeReview.mode', originalNarrativeReviewMode);
    }
    if (app) await app.close();
  });

  it('freezes confirmed actual facts, separates currencies, grounds AI claims, and rejects mutation', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [bossLogin, employeeLogin, financeLogin] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: '123456' }).expect(200),
      request(app.getHttpServer()).post('/api/auth/login').send({ username: 'employee', password: '123456' }).expect(200),
      request(app.getHttpServer()).post('/api/auth/login').send({ username: 'finance', password: '123456' }).expect(200)
    ]);
    const bossToken = bossLogin.body.data.accessToken as string;
    const employeeToken = employeeLogin.body.data.accessToken as string;
    const financeToken = financeLogin.body.data.accessToken as string;
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
    expect(sources.body.data).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      snapshot: {
        snapshotId: result.snapshot.snapshotId,
        snapshotHash: result.snapshot.snapshotHash,
        sourceDigest: result.snapshot.sourceDigest,
        dataWatermark: result.snapshot.dataWatermark,
        sourceCount: 3
      }
    });
    expect(sources.body.data.items).toHaveLength(2);
    expect(sources.body.data.items.every((item: { recordHash: string }) => /^[a-f0-9]{64}$/.test(item.recordHash))).toBe(true);
    expect(sources.body.data.items.every((item: { projectName: string }) => item.projectName === project.name)).toBe(true);
    const repeatedSources = await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);
    expect(repeatedSources.body.data.items).toEqual(sources.body.data.items);
    const remainingSources = await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?page=2&pageSize=2`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);
    expect(remainingSources.body.data).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(remainingSources.body.data.items).toHaveLength(1);
    const expenseSources = await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?projectId=${project.id}&currency=CNY&accountingDirection=expense`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);
    expect(expenseSources.body.data).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(expenseSources.body.data.items).toEqual([
      expect.objectContaining({
        projectId: project.id,
        projectName: project.name,
        currency: 'CNY',
        accountingDirection: 'expense',
        amount: '400.05'
      })
    ]);
    const usdSources = await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?currency=USD`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);
    expect(usdSources.body.data).toMatchObject({ total: 1 });
    expect(usdSources.body.data.items[0]).toMatchObject({ currency: 'USD', amount: '7.25' });
    await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?page=1&pageSize=101`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?currency=cny`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/reports/snapshots/${result.snapshot.snapshotId}/sources?accountingDirection=unknown`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(400);

    const repeated = await request(app.getHttpServer())
      .post('/api/reports/snapshots')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-15', projectIds: [project.id] })
      .expect(201);
    expect(repeated.body.data).toMatchObject({ reused: true, sourceCount: 3 });
    expect(repeated.body.data.snapshot.snapshotId).toBe(result.snapshot.snapshotId);
    expect(repeated.body.data.snapshot.snapshotHash).toBe(result.snapshot.snapshotHash);

    const concurrentDate = new Date('2042-03-16T20:00:00.000Z');
    await prisma.businessRecord.create({
      data: {
        ...base,
        recordDate: concurrentDate,
        accountingDirection: AccountingDirection.income,
        amount: new Prisma.Decimal('12.34'),
        currency: 'CNY',
        sourceId: `report-concurrent-${suffix}`,
        status: BusinessRecordStatus.confirmed,
        dataLayer: RecordDataLayer.actual,
        confirmedAt: concurrentDate,
        confirmedBy: boss.id
      }
    });
    const concurrentRequests = await Promise.all(Array.from({ length: 6 }, () => (
      request(app.getHttpServer())
        .post('/api/reports/snapshots')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-17', projectIds: [project.id] })
    )));
    expect(concurrentRequests.map((response) => response.status)).toEqual([201, 201, 201, 201, 201, 201]);
    const concurrentSnapshotIds = concurrentRequests.map((response) => response.body.data.snapshot.snapshotId as string);
    expect(new Set(concurrentSnapshotIds).size).toBe(1);
    expect(concurrentRequests.filter((response) => response.body.data.reused === false)).toHaveLength(1);
    expect(await prisma.reportSnapshot.count({ where: { id: { in: concurrentSnapshotIds } } })).toBe(1);
    expect(await prisma.reportSnapshotSource.count({ where: { snapshotId: concurrentSnapshotIds[0] } })).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${result.snapshot.snapshotId}/narrative`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${result.snapshot.snapshotId}/narrative`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({})
      .expect(403);

    config.set('ai.reportMode', 'suggest');
    config.set('ai.globalKillSwitch', true);
    const killedProviderSpy = jest.spyOn(provider, 'generate');
    const killed = await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${result.snapshot.snapshotId}/narrative`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .expect(201);
    expect(killed.body.data).toMatchObject({ status: 'disabled', reasonCode: 'AI_DISABLED' });
    expect(killedProviderSpy).not.toHaveBeenCalled();
    killedProviderSpy.mockRestore();

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

    const narrativeId = generated.body.data.narrative.id as string;
    const narrativeHash = generated.body.data.narrative.narrativeHash as string;
    const snapshotHash = result.snapshot.snapshotHash as string;
    const narrativeBeforeReview = await prisma.reportNarrative.findUniqueOrThrow({
      where: { id: narrativeId },
      select: { narrativeHash: true, narrativeJson: true }
    });
    const immutableFactsBeforeReview = {
      businessRecords: await prisma.businessRecord.count({ where: { projectId: project.id } }),
      snapshots: await prisma.reportSnapshot.count({ where: { id: result.snapshot.snapshotId } }),
      claims: await prisma.aiFinancialClaim.count({ where: { reportNarrativeId: narrativeId } })
    };
    const reviewBody = {
      expectedReviewVersion: 0,
      expectedNarrativeHash: narrativeHash,
      expectedSnapshotHash: snapshotHash,
      command: ReportNarrativeReviewCommand.ACCEPT,
      reason: '合成验收：财务核对快照与叙述依据一致'
    };

    config.set('reportNarrativeReview.mode', 'disabled');
    await request(app.getHttpServer())
      .post(`/api/ai/report-narratives/${narrativeId}/review`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send(reviewBody)
      .expect(409);
    expect(await prisma.reportNarrativeReviewDecision.count({ where: { narrativeId } })).toBe(0);

    config.set('reportNarrativeReview.mode', 'finance_then_boss');
    await request(app.getHttpServer())
      .get('/api/ai/report-narratives?page=1&pageSize=10')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);

    const financePending = await request(app.getHttpServer())
      .get('/api/ai/report-narratives?page=1&pageSize=10')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(financePending.body.data.policy).toMatchObject({
      enabled: true,
      workflow: 'FINANCE_THEN_BOSS'
    });
    expect(financePending.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: narrativeId,
        review: expect.objectContaining({
          status: ReportNarrativeReviewStatus.NEEDS_FINANCE_REVIEW,
          version: 0
        })
      })
    ]));

    await request(app.getHttpServer())
      .post(`/api/ai/report-narratives/${narrativeId}/review`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send(reviewBody)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/ai/report-narratives/${narrativeId}/review`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ ...reviewBody, reason: 'x\u0001y' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/ai/report-narratives/${narrativeId}/review`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ ...reviewBody, expectedNarrativeHash: '0'.repeat(64) })
      .expect(409);
    expect(await prisma.reportNarrativeReviewDecision.count({ where: { narrativeId } })).toBe(0);

    const concurrentFinanceReviews = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/ai/report-narratives/${narrativeId}/review`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send(reviewBody),
      request(app.getHttpServer())
        .post(`/api/ai/report-narratives/${narrativeId}/review`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send(reviewBody)
    ]);
    expect(concurrentFinanceReviews.map((response) => response.status).sort()).toEqual([201, 409]);
    const financeAccepted = concurrentFinanceReviews.find((response) => response.status === 201)!;
    expect(financeAccepted.body.data.review).toMatchObject({
      status: ReportNarrativeReviewStatus.NEEDS_BOSS_REVIEW,
      version: 1
    });
    expect(financeAccepted.body.data.review.history).toEqual([
      expect.objectContaining({
        reviewVersion: 1,
        stage: 'FINANCE',
        command: ReportNarrativeReviewCommand.ACCEPT,
        actor: expect.objectContaining({ username: 'finance' })
      })
    ]);
    expect(await prisma.reportNarrativeReviewDecision.count({ where: { narrativeId } })).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/ai/report-narratives/${narrativeId}/review`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send(reviewBody)
      .expect(409);

    const bossPending = await request(app.getHttpServer())
      .get('/api/ai/report-narratives?page=1&pageSize=10')
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);
    expect(bossPending.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: narrativeId,
        review: expect.objectContaining({
          status: ReportNarrativeReviewStatus.NEEDS_BOSS_REVIEW,
          version: 1
        })
      })
    ]));

    const bossAccepted = await request(app.getHttpServer())
      .post(`/api/ai/report-narratives/${narrativeId}/review`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        ...reviewBody,
        expectedReviewVersion: 1,
        reason: '合成验收：老板确认仅采纳已核验的文字叙述'
      })
      .expect(201);
    expect(bossAccepted.body.data.review).toMatchObject({
      status: ReportNarrativeReviewStatus.ACCEPTED,
      version: 2
    });
    expect(bossAccepted.body.data.review.history).toHaveLength(2);
    expect(await prisma.auditLog.count({
      where: {
        action: 'report.narrative.reviewed',
        resourceType: 'report_narrative',
        resourceId: narrativeId
      }
    })).toBe(2);

    expect({
      businessRecords: await prisma.businessRecord.count({ where: { projectId: project.id } }),
      snapshots: await prisma.reportSnapshot.count({ where: { id: result.snapshot.snapshotId } }),
      claims: await prisma.aiFinancialClaim.count({ where: { reportNarrativeId: narrativeId } })
    }).toEqual(immutableFactsBeforeReview);
    expect(await prisma.reportNarrative.findUniqueOrThrow({
      where: { id: narrativeId },
      select: { narrativeHash: true, narrativeJson: true }
    })).toEqual(narrativeBeforeReview);

    const firstReview = await prisma.reportNarrativeReviewDecision.findFirstOrThrow({
      where: { narrativeId },
      orderBy: { reviewVersion: 'asc' }
    });
    await expect(prisma.reportNarrativeReviewDecision.update({
      where: { id: firstReview.id },
      data: { reason: 'tampered' }
    })).rejects.toThrow('immutable report audit rows');
    await expect(prisma.reportNarrativeReviewDecision.delete({
      where: { id: firstReview.id }
    })).rejects.toThrow('immutable report audit rows');

    let releaseConcurrentProvider!: () => void;
    let markConcurrentProviderEntered!: () => void;
    const concurrentProviderGate = new Promise<void>((resolve) => { releaseConcurrentProvider = resolve; });
    const concurrentProviderEntered = new Promise<void>((resolve) => { markConcurrentProviderEntered = resolve; });
    const concurrentProviderSpy = jest.spyOn(provider, 'generate').mockImplementationOnce(async (providerRequest) => {
      await providerRequest.beforeProviderRequest?.();
      markConcurrentProviderEntered();
      await concurrentProviderGate;
      return {
        text: JSON.stringify(providerRequest.mockOutput),
        inputTokens: 1,
        outputTokens: 1,
        raw: { syntheticConcurrent: true }
      };
    });
    const concurrentNarrativePath = `/api/ai/report-snapshots/${concurrentSnapshotIds[0]}/narrative`;
    const leadingNarrativeRequest = request(app.getHttpServer())
      .post(concurrentNarrativePath)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .then((response) => response);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Concurrent report Provider did not start within 5 seconds')),
        5_000
      );
      concurrentProviderEntered.then(() => {
        clearTimeout(timer);
        resolve();
      }, reject);
    });
    const followerNarrativeRequests = Promise.all(Array.from({ length: 5 }, () => (
      request(app.getHttpServer())
        .post(concurrentNarrativePath)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({})
    )));
    releaseConcurrentProvider();
    const [leadingNarrative, followerNarratives] = await Promise.all([
      leadingNarrativeRequest,
      followerNarrativeRequests
    ]);
    expect(concurrentProviderSpy).toHaveBeenCalledTimes(1);
    concurrentProviderSpy.mockRestore();
    expect(leadingNarrative.status).toBe(201);
    expect(leadingNarrative.body.data.status).toBe('needs_finance_review');
    expect(followerNarratives.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
    expect(followerNarratives.every((response) => (
      ['in_progress', 'needs_finance_review'].includes(response.body.data.status)
    ))).toBe(true);
    expect(await prisma.reportNarrative.count({
      where: { snapshotId: concurrentSnapshotIds[0] }
    })).toBe(1);

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

    const providerFailureDate = new Date('2042-03-17T20:00:00.000Z');
    await prisma.businessRecord.create({
      data: {
        ...base,
        recordDate: providerFailureDate,
        accountingDirection: AccountingDirection.expense,
        amount: new Prisma.Decimal('3.21'),
        currency: 'CNY',
        sourceId: `report-provider-failure-${suffix}`,
        status: BusinessRecordStatus.confirmed,
        dataLayer: RecordDataLayer.actual,
        confirmedAt: providerFailureDate,
        confirmedBy: boss.id
      }
    });
    const providerFailureSnapshot = await request(app.getHttpServer())
      .post('/api/reports/snapshots')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-18', projectIds: [project.id] })
      .expect(201);
    const providerFailureSnapshotId = providerFailureSnapshot.body.data.snapshot.snapshotId as string;
    const providerFailureSpy = jest.spyOn(provider, 'generate').mockImplementationOnce(async (providerRequest) => {
      await providerRequest.beforeProviderRequest?.();
      throw new Error('synthetic Provider timeout Bearer super-secret-token?token=also-secret');
    });
    const providerFailure = await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${providerFailureSnapshotId}/narrative`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .expect(201);
    providerFailureSpy.mockRestore();
    expect(providerFailure.body.data).toMatchObject({
      status: 'failed',
      reasonCode: 'AI_SUGGESTION_FAILED'
    });
    expect(await prisma.reportNarrative.count({ where: { snapshotId: providerFailureSnapshotId } })).toBe(0);
    const failedTask = await prisma.aiTask.findFirstOrThrow({
      where: { resourceType: 'report_snapshot', resourceId: providerFailureSnapshotId }
    });
    expect(failedTask.status).toBe('failed');
    expect(failedTask.errorMessage).not.toContain('super-secret-token');
    expect(failedTask.errorMessage).not.toContain('also-secret');

    const truncatedDate = new Date('2042-03-18T20:00:00.000Z');
    await prisma.businessRecord.create({
      data: {
        ...base,
        recordDate: truncatedDate,
        accountingDirection: AccountingDirection.income,
        amount: new Prisma.Decimal('4.56'),
        currency: 'CNY',
        sourceId: `report-truncated-${suffix}`,
        status: BusinessRecordStatus.confirmed,
        dataLayer: RecordDataLayer.actual,
        confirmedAt: truncatedDate,
        confirmedBy: boss.id
      }
    });
    const truncatedSnapshot = await request(app.getHttpServer())
      .post('/api/reports/snapshots')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ reportType: ReportSnapshotType.DAILY, date: '2042-03-19', projectIds: [project.id] })
      .expect(201);
    const truncatedSnapshotId = truncatedSnapshot.body.data.snapshot.snapshotId as string;
    const truncatedProviderSpy = jest.spyOn(provider, 'generate').mockImplementationOnce(async (providerRequest) => {
      await providerRequest.beforeProviderRequest?.();
      return {
        text: '{"schemaVersion":"report-narrative/1.0"',
        inputTokens: 1,
        outputTokens: 1,
        raw: { syntheticTruncated: true }
      };
    });
    const truncated = await request(app.getHttpServer())
      .post(`/api/ai/report-snapshots/${truncatedSnapshotId}/narrative`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({})
      .expect(201);
    truncatedProviderSpy.mockRestore();
    expect(truncated.body.data).toMatchObject({ status: 'failed', reasonCode: 'AI_SUGGESTION_FAILED' });
    expect(await prisma.reportNarrative.count({ where: { snapshotId: truncatedSnapshotId } })).toBe(0);
  });
});
