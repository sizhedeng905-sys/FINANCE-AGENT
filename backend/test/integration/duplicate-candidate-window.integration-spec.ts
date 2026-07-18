import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, WorkOrderStatus, WorkOrderType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('duplicate candidate window persistence and audit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let financeToken: string;
  let projectId: string;
  let ruleId: string;
  let candidateId: string;
  let currentId: string;
  const additionalWorkOrderIds: string[] = [];
  const suffix = randomUUID();

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    if (!databaseName.endsWith('_test')) throw new Error('Duplicate window integration refuses a non-test database.');

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

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' });
    expect(login.status).toBe(200);
    financeToken = login.body.data.accessToken as string;

    const [finance, employee] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { username: 'finance' } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'employee' } })
    ]);
    const project = await prisma.project.create({
      data: {
        name: `duplicate-window-${suffix}`,
        customerName: 'Synthetic duplicate candidate customer',
        ownerName: finance.name,
        createdBy: finance.username
      }
    });
    projectId = project.id;
    const candidate = await prisma.workOrder.create({
      data: {
        orderNo: `DUP-CANDIDATE-${suffix}`,
        type: WorkOrderType.expense,
        projectId,
        projectName: project.name,
        customerName: project.customerName,
        creatorId: employee.id,
        creatorName: employee.name,
        amount: new Prisma.Decimal('100.00'),
        cost: new Prisma.Decimal('100.00'),
        status: WorkOrderStatus.finance_reviewing,
        description: 'Synthetic duplicate candidate',
        occurredDate: new Date('2025-12-30T00:00:00.000Z')
      }
    });
    candidateId = candidate.id;
    const current = await prisma.workOrder.create({
      data: {
        orderNo: `DUP-CURRENT-${suffix}`,
        type: WorkOrderType.expense,
        projectId,
        projectName: project.name,
        customerName: project.customerName,
        creatorId: employee.id,
        creatorName: employee.name,
        amount: new Prisma.Decimal('100.00'),
        cost: new Prisma.Decimal('100.00'),
        status: WorkOrderStatus.ai_reviewing,
        description: 'Synthetic duplicate window evaluation',
        occurredDate: new Date('2026-01-01T00:00:00.000Z'),
        submittedAt: new Date('2026-01-01T02:00:00.000Z')
      }
    });
    currentId = current.id;
  });

  afterAll(async () => {
    if (prisma) {
      const workOrderIds = [candidateId, currentId, ...additionalWorkOrderIds].filter(Boolean);
      const resourceIds = [projectId, ruleId, ...workOrderIds].filter(Boolean);
      if (workOrderIds.length) {
        await prisma.notification.deleteMany({ where: { relatedWorkOrderId: { in: workOrderIds } } });
      }
      if (currentId || candidateId) {
        await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
      }
      if (ruleId) await prisma.riskRule.deleteMany({ where: { id: ruleId } });
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (resourceIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      }
    }
    if (app) await app.close();
  });

  it('accepts zero days, persists the effective value, updates it, and rejects values above 365', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/risk-rules')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        ruleKey: `duplicate_window_${suffix.replace(/-/g, '_')}`,
        ruleName: 'Synthetic duplicate candidate window',
        ruleType: 'duplicate_submission',
        severity: 'medium',
        conditionJson: { windowDays: 0 },
        description: 'Candidate only; H03 pending'
      });
    expect(created.status).toBe(201);
    expect(created.body.data.conditionJson).toEqual({ windowDays: 0 });
    ruleId = created.body.data.id as string;
    expect((await prisma.riskRule.findUniqueOrThrow({ where: { id: ruleId } })).conditionJson)
      .toEqual({ windowDays: 0 });

    const updated = await request(app.getHttpServer())
      .patch(`/api/risk-rules/${ruleId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ conditionJson: { windowDays: 365 } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.conditionJson).toEqual({ windowDays: 365 });

    const narrowed = await request(app.getHttpServer())
      .patch(`/api/risk-rules/${ruleId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ conditionJson: { windowDays: 2 } });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.data.conditionJson).toEqual({ windowDays: 2 });

    await request(app.getHttpServer())
      .post('/api/risk-rules')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        ruleKey: `duplicate_invalid_${suffix.replace(/-/g, '_')}`,
        ruleName: 'Invalid duplicate window',
        ruleType: 'duplicate_submission',
        severity: 'medium',
        conditionJson: { windowDays: 366 }
      })
      .expect(400);
  });

  it('uses the persisted window and writes the same candidate-only boundary to result, anomaly, audit, and ledger', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/work-orders/${currentId}/run-rules`)
      .set('Authorization', `Bearer ${financeToken}`)
      .set('X-Request-Id', `duplicate-window-${suffix}`);
    expect(response.status).toBe(201);
    const result = response.body.data.results.find((item: { ruleId: string }) => item.ruleId === ruleId);
    expect(result).toMatchObject({
      passed: false,
      result: {
        hit: true,
        reason: expect.stringContaining('重复候选'),
        evidence: {
          candidateOnly: true,
          policyStatus: 'pending_human_decision',
          automaticAction: 'none',
          sourceScope: 'WORK_ORDER_ONLY',
          crossSourceNormalizationPolicy: 'H03_PENDING_NOT_APPLIED',
          dispositionPolicy: 'H03_PENDING_MANUAL_REVIEW_ONLY',
          windowDays: 2,
          windowStartInclusive: '2025-12-30T00:00:00.000Z',
          windowEndExclusive: '2026-01-04T00:00:00.000Z',
          duplicateWorkOrderId: candidateId,
          matchedDayOffset: -2,
          matchedSignals: ['AMOUNT_EXACT']
        }
      }
    });

    const [storedResult, anomaly, audit, ledger] = await Promise.all([
      prisma.ruleRunResult.findFirstOrThrow({ where: { workOrderId: currentId, ruleId } }),
      prisma.aiAnomaly.findUniqueOrThrow({ where: { workOrderId_ruleId: { workOrderId: currentId, ruleId } } }),
      prisma.auditLog.findFirstOrThrow({
        where: { resourceId: currentId, action: 'work_order.rules.run' },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.ledgerEvent.findFirstOrThrow({
        where: { aggregateId: currentId, eventType: 'work_order_rules_completed' },
        orderBy: { createdAt: 'desc' }
      })
    ]);
    expect(storedResult.resultJson).toMatchObject(result.result);
    expect(anomaly.evidence).toMatchObject(result.result.evidence);
    for (const metadata of [audit.metadata, ledger.payload] as Prisma.JsonValue[]) {
      const duplicateCandidateWindows = (metadata as {
        duplicateCandidateWindows: Array<Record<string, unknown>>;
      }).duplicateCandidateWindows;
      expect(duplicateCandidateWindows.find((item) => item.ruleId === ruleId)).toMatchObject({
        ruleId,
        hit: true,
        candidateOnly: true,
        policyStatus: 'pending_human_decision',
        windowDays: 2,
        windowStartInclusive: '2025-12-30T00:00:00.000Z',
        windowEndExclusive: '2026-01-04T00:00:00.000Z',
        duplicateWorkOrderId: candidateId,
        matchedDayOffset: -2,
        matchedSignals: ['AMOUNT_EXACT'],
        automaticAction: 'none'
      });
    }
    expect(await prisma.workOrder.count({ where: { id: candidateId } })).toBe(1);
  });

  it('includes the positive boundary and excludes the first day beyond it', async () => {
    const [project, employee] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'employee' } })
    ]);
    await prisma.workOrder.update({
      where: { id: candidateId },
      data: { occurredDate: new Date('2026-01-04T00:00:00.000Z'), amount: '222.00', cost: '222.00' }
    });
    const outside = await prisma.workOrder.create({
      data: {
        orderNo: `DUP-OUTSIDE-${suffix}`,
        type: WorkOrderType.expense,
        projectId,
        projectName: project.name,
        customerName: project.customerName,
        creatorId: employee.id,
        creatorName: employee.name,
        amount: '222.00',
        cost: '222.00',
        status: WorkOrderStatus.ai_reviewing,
        description: 'Synthetic upper exclusive boundary',
        occurredDate: new Date('2026-01-01T00:00:00.000Z'),
        submittedAt: new Date('2026-01-01T02:00:00.000Z')
      }
    });
    additionalWorkOrderIds.push(outside.id);
    const outsideResponse = await request(app.getHttpServer())
      .post(`/api/work-orders/${outside.id}/run-rules`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(outsideResponse.status).toBe(201);
    expect(outsideResponse.body.data.results.find((item: { ruleId: string }) => item.ruleId === ruleId))
      .toMatchObject({ passed: true, result: { hit: false, evidence: { duplicateWorkOrderId: null } } });

    await prisma.workOrder.update({
      where: { id: candidateId },
      data: { occurredDate: new Date('2026-01-03T23:59:59.999Z'), amount: '333.00', cost: '333.00' }
    });
    const boundary = await prisma.workOrder.create({
      data: {
        orderNo: `DUP-BOUNDARY-${suffix}`,
        type: WorkOrderType.expense,
        projectId,
        projectName: project.name,
        customerName: project.customerName,
        creatorId: employee.id,
        creatorName: employee.name,
        amount: '333.00',
        cost: '333.00',
        status: WorkOrderStatus.ai_reviewing,
        description: 'Synthetic upper inclusive boundary',
        occurredDate: new Date('2026-01-01T00:00:00.000Z'),
        submittedAt: new Date('2026-01-01T02:00:00.000Z')
      }
    });
    additionalWorkOrderIds.push(boundary.id);
    const boundaryResponse = await request(app.getHttpServer())
      .post(`/api/work-orders/${boundary.id}/run-rules`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(boundaryResponse.status).toBe(201);
    expect(boundaryResponse.body.data.results.find((item: { ruleId: string }) => item.ruleId === ruleId))
      .toMatchObject({
        passed: false,
        result: {
          hit: true,
          evidence: { duplicateWorkOrderId: candidateId, matchedDayOffset: 2 }
        }
      });
    expect(await prisma.workOrder.count({ where: { id: candidateId } })).toBe(1);
  });
});
