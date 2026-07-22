import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, RiskLevel, WorkOrderStatus, WorkOrderType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { FINANCIAL_THRESHOLD_MAX } from '../../src/risk-rules/financial-threshold';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('financial threshold PostgreSQL precision contract', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let financeToken: string;
  let projectId: string;
  let ruleId: string;
  let legacyApiRuleId: string;
  let legacyStoredRuleId: string;
  let workOrderId: string;
  const suffix = randomUUID();

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    if (!databaseName.endsWith('_test')) throw new Error('Financial threshold integration refuses a non-test database.');

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

    const finance = await prisma.user.findUniqueOrThrow({ where: { username: 'finance' } });
    const project = await prisma.project.create({
      data: {
        name: `financial-threshold-${suffix}`,
        customerName: 'Synthetic threshold customer',
        ownerName: finance.name,
        createdBy: finance.username
      }
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (prisma) {
      const ruleIds = [ruleId, legacyApiRuleId, legacyStoredRuleId].filter(Boolean);
      const resourceIds = [projectId, workOrderId, ...ruleIds].filter(Boolean);
      if (workOrderId) await prisma.notification.deleteMany({ where: { relatedWorkOrderId: workOrderId } });
      if (workOrderId) await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
      if (ruleIds.length) await prisma.riskRule.deleteMany({ where: { id: { in: ruleIds } } });
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (resourceIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      }
    }
    if (app) await app.close();
  });

  it('persists canonical strings, warns for safe legacy integers, and rejects unsafe numeric input', async () => {
    const keySuffix = suffix.replace(/-/g, '_');
    const canonical = await request(app.getHttpServer())
      .post('/api/risk-rules')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        ruleKey: `decimal_threshold_${keySuffix}`,
        ruleName: 'Synthetic decimal threshold',
        ruleType: 'amount_threshold',
        severity: RiskLevel.medium,
        conditionJson: { threshold: '0.1' }
      });
    expect(canonical.status).toBe(201);
    expect(canonical.body.data).toMatchObject({
      conditionJson: { threshold: '0.10' },
      compatibilityWarnings: []
    });
    ruleId = canonical.body.data.id as string;
    expect((await prisma.riskRule.findUniqueOrThrow({ where: { id: ruleId } })).conditionJson)
      .toEqual({ threshold: '0.10' });

    const maximum = await request(app.getHttpServer())
      .patch(`/api/risk-rules/${ruleId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ conditionJson: { threshold: FINANCIAL_THRESHOLD_MAX } });
    expect(maximum.status).toBe(200);
    expect(maximum.body.data.conditionJson).toEqual({ threshold: FINANCIAL_THRESHOLD_MAX });
    const restored = await request(app.getHttpServer())
      .patch(`/api/risk-rules/${ruleId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ conditionJson: { threshold: '0.10' } });
    expect(restored.status).toBe(200);

    const legacy = await request(app.getHttpServer())
      .post('/api/risk-rules')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        ruleKey: `legacy_threshold_${keySuffix}`,
        ruleName: 'Synthetic legacy threshold',
        ruleType: 'missing_attachment',
        severity: RiskLevel.low,
        conditionJson: { threshold: 1000, workOrderType: 'expense' },
        isActive: false
      });
    expect(legacy.status).toBe(201);
    expect(legacy.body.data).toMatchObject({
      conditionJson: { threshold: '1000.00', workOrderType: 'expense' },
      compatibilityWarnings: [{
        code: 'RISK_RULE_THRESHOLD_NUMERIC_DEPRECATED',
        field: 'conditionJson.threshold'
      }]
    });
    legacyApiRuleId = legacy.body.data.id as string;
    const legacyAudit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: legacyApiRuleId, action: 'risk_rule.create' },
      orderBy: { createdAt: 'desc' }
    });
    expect(legacyAudit.metadata).toMatchObject({
      compatibilityWarnings: [expect.objectContaining({ code: 'RISK_RULE_THRESHOLD_NUMERIC_DEPRECATED' })]
    });

    const unsafeNumber = JSON.parse('99999999999999.99') as number;
    const unsafe = await request(app.getHttpServer())
      .post('/api/risk-rules')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        ruleKey: `unsafe_threshold_${keySuffix}`,
        ruleName: 'Synthetic unsafe threshold',
        ruleType: 'amount_threshold',
        severity: RiskLevel.medium,
        conditionJson: { threshold: unsafeNumber }
      });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body).toMatchObject({
      code: 40001,
      data: {
        reason: 'RISK_RULE_THRESHOLD_NUMERIC_UNSAFE',
        field: 'conditionJson.threshold',
        maximum: FINANCIAL_THRESHOLD_MAX,
        scale: 2
      }
    });
    await request(app.getHttpServer())
      .post('/api/risk-rules')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        ruleKey: `overflow_threshold_${keySuffix}`,
        ruleName: 'Synthetic overflow threshold',
        ruleType: 'amount_threshold',
        severity: RiskLevel.medium,
        conditionJson: { threshold: '1000000000000.00' }
      })
      .expect(400)
      .expect(({ body }) => expect(body.data.reason).toBe('RISK_RULE_THRESHOLD_RANGE_INVALID'));
  });

  it('compares cents with Decimal and audits canonical and legacy stored rule inputs', async () => {
    const [project, employee] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'employee' } })
    ]);
    const legacyStored = await prisma.riskRule.create({
      data: {
        ruleKey: `stored_legacy_threshold_${suffix.replace(/-/g, '_')}`,
        ruleName: 'Synthetic stored legacy threshold',
        ruleType: 'amount_threshold',
        targetType: 'work_order',
        severity: RiskLevel.low,
        conditionJson: { threshold: 1 },
        createdBy: 'integration'
      }
    });
    legacyStoredRuleId = legacyStored.id;
    const workOrder = await prisma.workOrder.create({
      data: {
        orderNo: `DECIMAL-THRESHOLD-${suffix}`,
        type: WorkOrderType.expense,
        projectId,
        projectName: project.name,
        customerName: project.customerName,
        creatorId: employee.id,
        creatorName: employee.name,
        amount: new Prisma.Decimal('0.10'),
        cost: new Prisma.Decimal('0.10'),
        status: WorkOrderStatus.ai_reviewing,
        description: 'Synthetic exact-cent threshold comparison',
        occurredDate: new Date('2026-07-18T00:00:00.000Z'),
        submittedAt: new Date('2026-07-18T02:00:00.000Z')
      }
    });
    workOrderId = workOrder.id;

    const response = await request(app.getHttpServer())
      .post(`/api/work-orders/${workOrderId}/run-rules`)
      .set('Authorization', `Bearer ${financeToken}`)
      .set('X-Request-Id', `financial-threshold-${suffix}`);
    expect(response.status).toBe(201);
    const canonicalResult = response.body.data.results.find((item: { ruleId: string }) => item.ruleId === ruleId);
    expect(canonicalResult).toMatchObject({
      passed: true,
      result: {
        hit: false,
        evidence: {
          amount: '0.10',
          threshold: '0.10',
          thresholdSchemaVersion: 'financial-threshold/1.0',
          thresholdInputMode: 'decimal_string',
          compatibilityWarnings: []
        }
      }
    });
    const legacyResult = response.body.data.results.find(
      (item: { ruleId: string }) => item.ruleId === legacyStoredRuleId
    );
    expect(legacyResult).toMatchObject({
      passed: true,
      result: {
        evidence: {
          threshold: '1.00',
          thresholdInputMode: 'legacy_safe_integer_number',
          compatibilityWarnings: [{ code: 'RISK_RULE_THRESHOLD_NUMERIC_DEPRECATED' }]
        }
      }
    });
    expect(await prisma.aiAnomaly.count({ where: { workOrderId, ruleId } })).toBe(0);

    const [storedResult, audit] = await Promise.all([
      prisma.ruleRunResult.findFirstOrThrow({ where: { workOrderId, ruleId } }),
      prisma.auditLog.findFirstOrThrow({
        where: { resourceId: workOrderId, action: 'work_order.rules.run' },
        orderBy: { createdAt: 'desc' }
      })
    ]);
    expect(storedResult.resultJson).toMatchObject(canonicalResult.result);
    const thresholds = (audit.metadata as {
      financialThresholds: Array<Record<string, unknown>>;
    }).financialThresholds;
    expect(thresholds.find((item) => item.ruleId === ruleId)).toMatchObject({
      threshold: '0.10',
      thresholdSchemaVersion: 'financial-threshold/1.0',
      thresholdInputMode: 'decimal_string',
      compatibilityWarnings: []
    });
    expect(thresholds.find((item) => item.ruleId === legacyStoredRuleId)).toMatchObject({
      threshold: '1.00',
      thresholdInputMode: 'legacy_safe_integer_number',
      compatibilityWarnings: [{ code: 'RISK_RULE_THRESHOLD_NUMERIC_DEPRECATED' }]
    });
  });
});
