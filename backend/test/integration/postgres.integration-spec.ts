import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AccountingDirection,
  AiMessageRole,
  BusinessRecordPublicationStatus,
  BusinessRecordStatus,
  DataRecordType,
  FileScanStatus,
  FieldSuggestionStatus,
  FieldType,
  ImportRowStatus,
  ImportTaskStatus,
  MappingDecisionType,
  MappingProfileStatus,
  OcrAttemptStatus,
  OcrTaskStatus,
  Prisma,
  ProjectStatus,
  RawFileStatus,
  RecordDataLayer,
  RecordSourceType,
  SemanticType,
  UserRole,
  UserStatus,
  WorkOrderStatus,
  WorkOrderType
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import * as XLSX from 'xlsx';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { LocalFileStorageService } from '../../src/files/local-file-storage.service';
import { StorageCapacityService } from '../../src/files/storage-capacity.service';
import { UploadAdmissionService } from '../../src/files/upload-admission.service';
import { ExcelParserService } from '../../src/import-tasks/excel-parser.service';
import { ImportTasksService } from '../../src/import-tasks/import-tasks.service';
import { MockOcrProvider } from '../../src/ocr/mock-ocr.provider';
import { OcrTasksService } from '../../src/ocr/ocr-tasks.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { H02_POLICY_PENDING_REASON } from '../../src/record-policy/financial-policy-baseline';
import { dayRange, formatChinaDate, monthRange } from '../../src/reports/report-period';

const TEST_USER_PREFIX = 'integration_';

describe('real PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fileStorage: LocalFileStorageService;

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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true }
      })
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = app.get(PrismaService);
    fileStorage = app.get(LocalFileStorageService);
    await prisma.user.deleteMany({ where: { username: { startsWith: TEST_USER_PREFIX } } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { username: { startsWith: TEST_USER_PREFIX } } });
    }
    if (app) await app.close();
  });

  const waitForImportConfirmation = async (taskId: string, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
      if (
        task.status === ImportTaskStatus.confirmed ||
        task.status === ImportTaskStatus.confirmation_failed
      ) return task;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for import confirmation ${taskId}`);
  };

  type ImportApprovalView = {
    version: number;
    reviewRevision: number;
    validation: null | {
      snapshotHash: string;
      snapshot: {
        normalizedOutputHash: string;
        valid: boolean;
        warnings: Array<{ issueId: string }>;
        blockingErrors: Array<{ issueId: string }>;
        counts: { total: number; recordCount: number; blockingErrorCount: number };
      };
    };
  };

  const approvalPayloadFromTask = (task: ImportApprovalView) => {
    if (!task.validation) throw new Error('Import task is missing a validation snapshot');
    return {
      expectedVersion: task.version,
      expectedReviewRevision: task.reviewRevision,
      expectedValidationSnapshotHash: task.validation.snapshotHash,
      expectedPayloadHash: task.validation.snapshot.normalizedOutputHash,
      acknowledgedWarningIds: task.validation.snapshot.warnings.map((warning) => warning.issueId)
    };
  };

  const loadImportApproval = async (taskId: string, token: string, revalidate = true) => {
    const current = await request(app.getHttpServer())
      .get(`/api/import-tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    let task = current.body.data as ImportApprovalView;
    if (revalidate) {
      const validated = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/revalidate`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          expectedVersion: task.version,
          expectedReviewRevision: task.reviewRevision
        })
        .expect(201);
      task = validated.body.data as ImportApprovalView;
    }
    return { task, payload: approvalPayloadFromTask(task) };
  };

  const waitForOcrStatus = async (
    taskId: string,
    statuses: OcrTaskStatus[],
    timeoutMs = 30_000
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await prisma.ocrTask.findUniqueOrThrow({ where: { id: taskId } });
      if (statuses.includes(task.status)) return task;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for OCR task ${taskId}: ${statuses.join(',')}`);
  };

  it('logs in all eight seeded Chinese and English accounts from PostgreSQL', async () => {
    const usernames = ['员工', '财务', '复核员', '老板', 'employee', 'finance', 'reviewer', 'boss'];

    for (const username of usernames) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      expect(response.body.data).toMatchObject({ accessToken: expect.any(String), user: { username } });

      const stored = await prisma.user.findUniqueOrThrow({ where: { username } });
      expect(stored.passwordHash).not.toBe('123456');
      await expect(bcrypt.compare('123456', stored.passwordHash)).resolves.toBe(true);
    }
  });

  it('rejects missing, forged, expired, and stale-version bearer tokens', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'employee' } });
    const jwt = app.get(JwtService);
    const secret = app.get(ConfigService).getOrThrow<string>('jwtSecret');
    const issuer = app.get(ConfigService).getOrThrow<string>('jwtIssuer');
    const audience = app.get(ConfigService).getOrThrow<string>('jwtAudience');
    const expiredToken = await jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion, typ: 'access' },
      { secret, expiresIn: -1, algorithm: 'HS256', issuer, audience }
    );
    const staleToken = await jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion + 1, typ: 'access' },
      { secret, expiresIn: '5m', algorithm: 'HS256', issuer, audience }
    );
    const wrongAudienceToken = await jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion, typ: 'access' },
      { secret, expiresIn: '5m', algorithm: 'HS256', issuer, audience: 'other-api' }
    );
    const wrongAlgorithmToken = await jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion, typ: 'access' },
      { secret, expiresIn: '5m', algorithm: 'HS384', issuer, audience }
    );

    const attempts = [
      () => request(app.getHttpServer()).get('/api/auth/me'),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer forged.token.value'),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${expiredToken}`),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${staleToken}`),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${wrongAudienceToken}`),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${wrongAlgorithmToken}`)
    ];

    for (const attempt of attempts) {
      const response = await attempt().expect(401);
      expect(response.body).toMatchObject({ code: 40101, message: expect.any(String), data: {} });
    }
  });

  it('rejects a wrong password and a disabled account', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'employee', password: 'wrong-password' })
      .expect(401);

    await prisma.user.update({ where: { username: 'employee' }, data: { status: UserStatus.disabled } });
    try {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'employee', password: '123456' })
        .expect(401);
    } finally {
      await prisma.user.update({ where: { username: 'employee' }, data: { status: UserStatus.active } });
    }
  });

  it('revokes a real PostgreSQL-backed token on logout', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'employee', password: '123456' })
      .expect(200);
    const token = loginResponse.body.data.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('supports HttpOnly cookie auth and requires double-submit CSRF for writes', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/auth/login')
      .send({ username: '员工', password: '123456' })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toContain('finance_agent_session=');
    expect(cookies.join(';')).toContain('HttpOnly');
    const csrfCookie = cookies.find((cookie) => cookie.startsWith('finance_agent_csrf='));
    const csrfToken = decodeURIComponent(csrfCookie!.split(';')[0].slice('finance_agent_csrf='.length));

    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').expect(401);
    await agent.post('/api/auth/logout').set('X-CSRF-Token', csrfToken).expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('reserves MFA and issues a purpose-bound short-lived step-up token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: '123456' })
      .expect(200);
    const accessToken = login.body.data.accessToken as string;
    const capabilities = await request(app.getHttpServer())
      .get('/api/auth/security-capabilities')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(capabilities.body.data).toMatchObject({
      mfa: { status: 'reserved', enabled: false },
      stepUp: {
        status: 'available_disabled',
        mode: 'disabled',
        ttlSeconds: 300,
        maxUses: 1,
        tokenHeader: 'X-Step-Up-Token',
        pendingDecisionRefs: ['H10']
      }
    });
    const binding = {
      action: 'work_order.boss_approve',
      resourceType: 'work_order',
      resourceId: `synthetic-${randomUUID()}`
    };
    await request(app.getHttpServer())
      .post('/api/auth/step-up')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'wrong-password', ...binding })
      .expect(401);
    const elevated = await request(app.getHttpServer())
      .post('/api/auth/step-up')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: '123456', ...binding })
      .expect(200);
    expect(elevated.body.data).toMatchObject({
      stepUpToken: expect.any(String),
      expiresInSeconds: 300,
      maxUses: 1,
      binding,
      mfa: { status: 'reserved', verified: false }
    });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${elevated.body.data.stepUpToken}`)
      .expect(401);

    const boss = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } });
    const auditActions = await prisma.auditLog.findMany({
      where: { actorUserId: boss.id, action: { in: ['auth.step_up.failure', 'auth.step_up.success'] } }
    });
    expect(auditActions.map((item) => item.action)).toEqual(expect.arrayContaining([
      'auth.step_up.failure',
      'auth.step_up.success'
    ]));
  });

  it('keeps liveness responsive while a user has saturated large-upload slots', async () => {
    const admission = app.get(UploadAdmissionService);
    const reservations = await Promise.all(
      Array.from({ length: 5 }, () => admission.reserve('synthetic-load-user', 20 * 1024 * 1024))
    );
    try {
      await expect(admission.reserve('synthetic-load-user', 1024)).rejects.toThrow('Concurrent upload limit exceeded');
      const health = await request(app.getHttpServer()).get('/api/health/live').expect(200);
      expect(health.body.data).toEqual({ status: 'ok' });
    } finally {
      await Promise.all(reservations.map((reservation) => admission.release(reservation)));
    }
  });

  it('reports real database, storage, security, queue, and model readiness', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(response.body.data).toMatchObject({
      status: 'ok',
      checks: {
        database: { status: 'ok' },
        storage: { status: 'ok' },
        antivirus: { status: expect.stringMatching(/^(ok|not_required)$/) },
        queues: { status: 'ok', pending: expect.any(Object) },
        models: { status: 'ok', enabled: expect.any(Array) }
      }
    });
  });

  it('enforces the finance-to-boss management boundary in PostgreSQL mode', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const financeToken = loginResponse.body.data.accessToken as string;
    const boss = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } });

    await request(app.getHttpServer())
      .patch(`/api/users/${boss.id}/password`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ newPassword: '654321' })
      .expect(403);
  });

  it('separates system administration and notifies protected account targets', async () => {
    const suffix = Date.now().toString(36);
    const tokens = Object.fromEntries(await Promise.all(['finance', 'admin'].map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string];
    }))) as Record<'finance' | 'admin', string>;
    const createdIds: string[] = [];
    try {
      const reviewer = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ username: `b8_reviewer_${suffix}`, password: '123456', name: 'B8 Reviewer', role: UserRole.employee })
        .expect(201);
      const reviewerId = reviewer.body.data.id as string;
      createdIds.push(reviewerId);
      await request(app.getHttpServer())
        .patch(`/api/users/${reviewerId}`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ role: UserRole.reviewer })
        .expect(200);

      const financeTarget = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ username: `b8_finance_${suffix}`, password: '123456', name: 'B8 Finance', role: UserRole.finance })
        .expect(201);
      const financeTargetId = financeTarget.body.data.id as string;
      createdIds.push(financeTargetId);

      for (const targetId of [reviewerId, financeTargetId]) {
        await request(app.getHttpServer())
          .patch(`/api/users/${targetId}/password`)
          .set('Authorization', `Bearer ${tokens.finance}`)
          .send({ newPassword: '654321' })
          .expect(403);
      }
      await request(app.getHttpServer())
        .patch(`/api/users/${reviewerId}/password`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ newPassword: '654321' })
        .expect(200);

      const [audits, notifications] = await Promise.all([
        prisma.auditLog.findMany({ where: { resourceId: reviewerId } }),
        prisma.notification.findMany({ where: { targetUserId: reviewerId } })
      ]);
      expect(audits.map((item) => item.action)).toEqual(expect.arrayContaining(['user.update', 'user.password.reset']));
      expect(notifications.map((item) => item.title)).toEqual(expect.arrayContaining([
        'Account privileges changed',
        'Password reset'
      ]));
    } finally {
      await prisma.notification.deleteMany({ where: { targetUserId: { in: createdIds } } });
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: createdIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    }
  });

  it('protects the final active boss in PostgreSQL mode', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: '123456' })
      .expect(200);
    const adminToken = loginResponse.body.data.accessToken as string;
    const englishBoss = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } });
    const chineseBoss = await prisma.user.findUniqueOrThrow({ where: { username: '老板' } });

    try {
      await request(app.getHttpServer())
        .patch(`/api/users/${chineseBoss.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: UserStatus.disabled })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/users/${englishBoss.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: UserStatus.disabled })
        .expect(409);
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: [englishBoss.id, chineseBoss.id] } },
        data: { status: UserStatus.active }
      });
    }
  });

  it('revokes PostgreSQL-backed tokens after password reset and account disable', async () => {
    const username = `${TEST_USER_PREFIX}token_revocation`;
    const bossLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: '123456' })
      .expect(200);
    const bossToken = bossLogin.body.data.accessToken as string;

    try {
      const createResponse = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ username, password: '123456', name: '令牌失效测试', role: UserRole.employee })
        .expect(201);
      const userId = createResponse.body.data.id as string;
      const firstLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      const firstToken = firstLogin.body.data.accessToken as string;

      await request(app.getHttpServer())
        .patch(`/api/users/${userId}/password`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ newPassword: '654321' })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${firstToken}`)
        .expect(401);

      const secondLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '654321' })
        .expect(200);
      const secondToken = secondLogin.body.data.accessToken as string;
      await request(app.getHttpServer())
        .patch(`/api/users/${userId}/status`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: UserStatus.disabled })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${secondToken}`)
        .expect(401);
    } finally {
      await prisma.user.deleteMany({ where: { username } });
    }
  });

  it('enforces real project permissions, pagination, soft archive, and audit context', async () => {
    const logins = await Promise.all(
      ['finance', 'boss', 'employee', 'reviewer'].map(async (username) => {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username, password: '123456' })
          .expect(200);
        return [username, response.body.data.accessToken as string] as const;
      })
    );
    const tokens = Object.fromEntries(logins) as Record<string, string>;
    const projectKeyword = `${TEST_USER_PREFIX}project_${randomUUID()}`;
    let projectId: string | undefined;

    try {
      await request(app.getHttpServer())
        .post('/api/projects')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          name: `${projectKeyword}_forged`,
          customerName: '测试客户',
          ownerName: '测试负责人',
          createdBy: 'forged-user-id'
        })
        .expect(400);

      const createResponse = await request(app.getHttpServer())
        .post('/api/projects')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-create')
        .send({
          name: `  ${projectKeyword}  `,
          customerName: '  集成测试客户  ',
          ownerName: '  集成负责人  ',
          description: '  项目真实权限测试  '
        })
        .expect(201);
      projectId = createResponse.body.data.id as string;
      expect(createResponse.body.data).toMatchObject({
        name: projectKeyword,
        customerName: '集成测试客户',
        ownerName: '集成负责人',
        status: ProjectStatus.active
      });

      const pageResponse = await request(app.getHttpServer())
        .get(`/api/projects?keyword=${encodeURIComponent(projectKeyword)}&page=1&pageSize=1`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(pageResponse.body.data).toMatchObject({ page: 1, pageSize: 1, total: 1 });
      expect(pageResponse.body.data.items).toHaveLength(1);

      await request(app.getHttpServer())
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/projects')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ name: '老板不可创建', customerName: '测试', ownerName: '测试' })
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/projects')
        .set('Authorization', `Bearer ${tokens.reviewer}`)
        .expect(403);

      const employeeActiveList = await request(app.getHttpServer())
        .get(`/api/projects?keyword=${encodeURIComponent(projectKeyword)}&status=archived`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(200);
      expect(employeeActiveList.body.data.items).toHaveLength(1);

      await request(app.getHttpServer())
        .patch(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ ownerName: '老板不可修改' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-update')
        .send({ ownerName: '  更新负责人  ' })
        .expect(200)
        .expect(({ body }) => expect(body.data.ownerName).toBe('更新负责人'));

      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-archive')
        .expect(200)
        .expect(({ body }) => expect(body.data.status).toBe(ProjectStatus.archived));

      const employeeAfterArchive = await request(app.getHttpServer())
        .get(`/api/projects?keyword=${encodeURIComponent(projectKeyword)}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(200);
      expect(employeeAfterArchive.body.data.items).toHaveLength(0);

      const audits = await prisma.auditLog.findMany({
        where: { resourceType: 'project', resourceId: projectId },
        orderBy: { createdAt: 'asc' }
      });
      expect(audits.map((audit) => [audit.action, audit.actorUsername, audit.requestId])).toEqual([
        ['project.create', 'finance', 'integration-project-create'],
        ['project.update', 'finance', 'integration-project-update'],
        ['project.archive', 'finance', 'integration-project-archive']
      ]);
    } finally {
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
    }
  });

  it('enforces real template permissions, clone integrity, delete guards, and audit context', async () => {
    const logins = await Promise.all(
      ['finance', 'boss', 'employee', 'reviewer'].map(async (username) => {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username, password: '123456' })
          .expect(200);
        return [username, response.body.data.accessToken as string] as const;
      })
    );
    const tokens = Object.fromEntries(logins) as Record<string, string>;
    const templateKeyword = `${TEST_USER_PREFIX}template_${randomUUID()}`;
    const templateIds: string[] = [];
    let projectTemplateId: string | undefined;

    try {
      for (const role of ['boss', 'employee', 'reviewer']) {
        await request(app.getHttpServer())
          .get('/api/templates')
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
      }

      await request(app.getHttpServer())
        .post('/api/templates')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          name: `${templateKeyword}_forged_system`,
          recordType: 'cost',
          isSystem: true
        })
        .expect(400);

      const createResponse = await request(app.getHttpServer())
        .post('/api/templates')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-create')
        .send({
          name: `  ${templateKeyword}  `,
          recordType: 'cost',
          dataLayer: RecordDataLayer.reconciliation,
          description: '  集成模板测试  '
        })
        .expect(201);
      const customTemplateId = createResponse.body.data.id as string;
      templateIds.push(customTemplateId);
      expect(createResponse.body.data).toMatchObject({
        name: templateKeyword,
        description: '集成模板测试',
        dataLayer: RecordDataLayer.reconciliation,
        isSystem: false
      });

      const listResponse = await request(app.getHttpServer())
        .get(`/api/templates?keyword=${encodeURIComponent(templateKeyword)}&recordType=cost&page=1&pageSize=1`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(listResponse.body.data).toMatchObject({ page: 1, pageSize: 1, total: 1 });
      expect(listResponse.body.data.items).toHaveLength(1);

      await request(app.getHttpServer())
        .patch(`/api/templates/${customTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-update')
        .send({ name: `  ${templateKeyword}_updated  `, dataLayer: RecordDataLayer.budget })
        .expect(200)
        .expect(({ body }) => expect(body.data).toMatchObject({
          name: `${templateKeyword}_updated`,
          dataLayer: RecordDataLayer.budget
        }));

      const sourceFields = await request(app.getHttpServer())
        .get('/api/templates/dt-transport/fields')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      const cloneResponse = await request(app.getHttpServer())
        .post('/api/templates/dt-transport/clone')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-clone')
        .expect(201);
      const clonedTemplateId = cloneResponse.body.data.id as string;
      templateIds.push(clonedTemplateId);
      expect(cloneResponse.body.data).toMatchObject({
        isSystem: false,
        name: '运输费用模板 副本',
        dataLayer: RecordDataLayer.actual
      });
      const clonedFields = await request(app.getHttpServer())
        .get(`/api/templates/${clonedTemplateId}/fields`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(clonedFields.body.data).toHaveLength(sourceFields.body.data.length);

      await request(app.getHttpServer())
        .delete('/api/templates/dt-transport')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(409);

      const projectTemplate = await prisma.projectTemplate.create({
        data: {
          projectId: 'dp-001',
          templateId: customTemplateId,
          recordType: DataRecordType.cost,
          customName: '集成测试启用模板'
        }
      });
      projectTemplateId = projectTemplate.id;
      await request(app.getHttpServer())
        .delete(`/api/templates/${customTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(409);
      await prisma.projectTemplate.delete({ where: { id: projectTemplate.id } });
      projectTemplateId = undefined;

      await request(app.getHttpServer())
        .delete(`/api/templates/${customTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-delete')
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/templates/${clonedTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-clone-delete')
        .expect(200);

      const audits = await prisma.auditLog.findMany({
        where: { resourceType: 'template', resourceId: { in: templateIds } }
      });
      expect(audits.map((audit) => [audit.action, audit.actorUsername, audit.requestId])).toEqual(
        expect.arrayContaining([
          ['template.create', 'finance', 'integration-template-create'],
          ['template.update', 'finance', 'integration-template-update'],
          ['template.clone', 'finance', 'integration-template-clone'],
          ['template.delete', 'finance', 'integration-template-delete'],
          ['template.delete', 'finance', 'integration-template-clone-delete']
        ])
      );
    } finally {
      if (projectTemplateId) {
        await prisma.projectTemplate.deleteMany({ where: { id: projectTemplateId } });
      }
      await prisma.template.deleteMany({ where: { id: { in: templateIds } } });
    }
  });

  it('enforces field dictionary and template-field invariants in PostgreSQL mode', async () => {
    const logins = await Promise.all(
      ['finance', 'boss', 'employee', 'reviewer'].map(async (username) => {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username, password: '123456' })
          .expect(200);
        return [username, response.body.data.accessToken as string] as const;
      })
    );
    const tokens = Object.fromEntries(logins) as Record<string, string>;
    const fieldIds: string[] = [];
    const templateFieldIds: string[] = [];
    let templateId: string | undefined;
    let recordId: string | undefined;

    try {
      for (const role of ['boss', 'employee', 'reviewer']) {
        await request(app.getHttpServer())
          .get('/api/fields')
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
      }

      await request(app.getHttpServer())
        .post('/api/fields')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          fieldName: `${TEST_USER_PREFIX}forged_active`,
          fieldType: FieldType.text,
          semanticType: SemanticType.remark,
          isActive: false
        })
        .expect(400);

      await request(app.getHttpServer())
        .get('/api/fields?isActive=not-a-boolean')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);

      const templateResponse = await request(app.getHttpServer())
        .post('/api/templates')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ name: `${TEST_USER_PREFIX}field_template`, recordType: DataRecordType.cost })
        .expect(201);
      templateId = templateResponse.body.data.id as string;

      const createField = async (
        suffix: string,
        fieldType: FieldType,
        semanticType: SemanticType,
        requestId: string,
        fieldKey?: string
      ) => {
        const response = await request(app.getHttpServer())
          .post('/api/fields')
          .set('Authorization', `Bearer ${tokens.finance}`)
          .set('X-Request-Id', requestId)
          .send({
            fieldName: `  ${TEST_USER_PREFIX}c3_${suffix}  `,
            fieldKey,
            fieldType,
            semanticType,
            aliases: ['  primary alias  ', 'secondary alias']
          })
          .expect(201);
        fieldIds.push(response.body.data.id as string);
        return response.body.data as { id: string; fieldKey: string; fieldName: string; aliases: string[] };
      };

      const first = await createField(
        'amount',
        FieldType.money,
        SemanticType.amount,
        'integration-field-create-first'
      );
      const second = await createField(
        'amount_copy',
        FieldType.number,
        SemanticType.amount,
        'integration-field-create-second',
        first.fieldKey
      );
      const third = await createField(
        'date',
        FieldType.date,
        SemanticType.date,
        'integration-field-create-third'
      );
      const disabled = await createField(
        'disabled',
        FieldType.text,
        SemanticType.remark,
        'integration-field-create-disabled'
      );

      expect(first).toMatchObject({
        fieldName: `${TEST_USER_PREFIX}c3_amount`,
        aliases: ['primary alias', 'secondary alias']
      });
      expect(second.fieldKey).toBe(`${first.fieldKey}_2`);

      await request(app.getHttpServer())
        .patch(`/api/fields/${first.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-field-update')
        .send({ description: '  field used by the integration template  ' })
        .expect(200)
        .expect(({ body }) => expect(body.data.description).toBe('field used by the integration template'));

      await request(app.getHttpServer())
        .patch(`/api/fields/${disabled.id}/disable`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-field-disable')
        .expect(200);

      const disabledList = await request(app.getHttpServer())
        .get(`/api/fields?keyword=${TEST_USER_PREFIX}c3_&isActive=false&page=1&pageSize=20`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(disabledList.body.data.items.map((field: { id: string }) => field.id)).toContain(disabled.id);
      expect(disabledList.body.data.items.every((field: { isActive: boolean }) => field.isActive === false)).toBe(true);

      await request(app.getHttpServer())
        .post(`/api/templates/${templateId}/fields`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ fieldId: disabled.id })
        .expect(409);

      const addTemplateField = async (fieldId: string, displayOrder: number, requestId: string) => {
        const response = await request(app.getHttpServer())
          .post(`/api/templates/${templateId}/fields`)
          .set('Authorization', `Bearer ${tokens.finance}`)
          .set('X-Request-Id', requestId)
          .send({ fieldId, displayOrder })
          .expect(201);
        templateFieldIds.push(response.body.data.id as string);
        return response.body.data as { id: string; fieldId: string; displayOrder: number };
      };

      const firstRelation = await addTemplateField(first.id, 1, 'integration-template-field-add-first');
      const secondRelation = await addTemplateField(second.id, 1, 'integration-template-field-add-second');
      const thirdRelation = await addTemplateField(third.id, 2, 'integration-template-field-add-third');

      await request(app.getHttpServer())
        .post(`/api/templates/${templateId}/fields`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ fieldId: first.id })
        .expect(409);

      let fieldsResponse = await request(app.getHttpServer())
        .get(`/api/templates/${templateId}/fields`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(fieldsResponse.body.data.map((item: { fieldId: string; displayOrder: number }) => [item.fieldId, item.displayOrder])).toEqual([
        [second.id, 1],
        [third.id, 2],
        [first.id, 3]
      ]);

      await request(app.getHttpServer())
        .patch(`/api/template-fields/${firstRelation.id}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ displayOrder: 1 })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/template-fields/${firstRelation.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-field-reorder')
        .send({ displayOrder: 1, isRequired: true })
        .expect(200);

      fieldsResponse = await request(app.getHttpServer())
        .get(`/api/templates/${templateId}/fields`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(fieldsResponse.body.data.map((item: { fieldId: string; displayOrder: number }) => [item.fieldId, item.displayOrder])).toEqual([
        [first.id, 1],
        [second.id, 2],
        [third.id, 3]
      ]);

      const usageResponse = await request(app.getHttpServer())
        .get(`/api/fields/${first.id}/usage`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(usageResponse.body.data).toMatchObject({ templateCount: 1, projectCount: 0 });
      expect(usageResponse.body.data.templates.map((template: { id: string }) => template.id)).toContain(templateId);

      await request(app.getHttpServer())
        .delete(`/api/template-fields/${secondRelation.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-field-remove')
        .expect(200);

      fieldsResponse = await request(app.getHttpServer())
        .get(`/api/templates/${templateId}/fields`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(fieldsResponse.body.data.map((item: { fieldId: string; displayOrder: number }) => [item.fieldId, item.displayOrder])).toEqual([
        [first.id, 1],
        [third.id, 2]
      ]);
      await request(app.getHttpServer())
        .get(`/api/fields/${second.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);

      const record = await prisma.businessRecord.create({
        data: {
          projectId: 'dp-001',
          templateId,
          recordType: DataRecordType.cost,
          recordDate: new Date('2026-07-11T00:00:00.000Z'),
          sourceType: RecordSourceType.manual,
          sourceId: `${TEST_USER_PREFIX}c3_record`,
          status: BusinessRecordStatus.pending_confirm,
          createdBy: 'finance'
        }
      });
      recordId = record.id;
      await prisma.recordValue.create({
        data: {
          recordId,
          fieldId: first.id,
          fieldName: first.fieldName,
          valueNumber: new Prisma.Decimal('12.34')
        }
      });
      await request(app.getHttpServer())
        .patch(`/api/fields/${first.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ fieldType: FieldType.date })
        .expect(409);

      const fieldAudits = await prisma.auditLog.findMany({
        where: { resourceType: 'field_definition', resourceId: { in: fieldIds } }
      });
      expect(fieldAudits.map((audit) => [audit.action, audit.actorUsername, audit.requestId])).toEqual(
        expect.arrayContaining([
          ['field_definition.create', 'finance', 'integration-field-create-first'],
          ['field_definition.update', 'finance', 'integration-field-update'],
          ['field_definition.disable', 'finance', 'integration-field-disable']
        ])
      );

      const relationAudits = await prisma.auditLog.findMany({
        where: { resourceType: 'template_field', resourceId: { in: templateFieldIds } }
      });
      expect(relationAudits.map((audit) => [audit.action, audit.actorUsername, audit.requestId])).toEqual(
        expect.arrayContaining([
          ['template_field.add', 'finance', 'integration-template-field-add-first'],
          ['template_field.update', 'finance', 'integration-template-field-reorder'],
          ['template_field.remove', 'finance', 'integration-template-field-remove']
        ])
      );

      expect(thirdRelation.id).toEqual(expect.any(String));
    } finally {
      if (recordId) await prisma.businessRecord.deleteMany({ where: { id: recordId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      if (fieldIds.length) await prisma.fieldDefinition.deleteMany({ where: { id: { in: fieldIds } } });
    }
  });

  it('enforces project-template lifecycle, permissions, idempotency, and archived-project boundaries', async () => {
    const logins = await Promise.all(
      ['finance', 'boss', 'employee', 'reviewer'].map(async (username) => {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username, password: '123456' })
          .expect(200);
        return [username, response.body.data.accessToken as string] as const;
      })
    );
    const tokens = Object.fromEntries(logins) as Record<string, string>;
    let projectId: string | undefined;
    let templateId: string | undefined;
    let projectTemplateId: string | undefined;

    try {
      const projectResponse = await request(app.getHttpServer())
        .post('/api/projects')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          name: `${TEST_USER_PREFIX}project_template_project`,
          customerName: 'Integration customer',
          ownerName: 'Integration owner'
        })
        .expect(201);
      projectId = projectResponse.body.data.id as string;

      const templateResponse = await request(app.getHttpServer())
        .post('/api/templates')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ name: `${TEST_USER_PREFIX}project_template_template`, recordType: DataRecordType.cost })
        .expect(201);
      templateId = templateResponse.body.data.id as string;

      for (const role of ['employee', 'reviewer']) {
        await request(app.getHttpServer())
          .get(`/api/projects/${projectId}/templates`)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
      }
      for (const role of ['boss', 'employee', 'reviewer']) {
        await request(app.getHttpServer())
          .post(`/api/projects/${projectId}/templates`)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .send({ templateId })
          .expect(403);
      }

      await request(app.getHttpServer())
        .post(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ templateId, customName: 'Forged inactive relation', isActive: false })
        .expect(400);

      const enableResponse = await request(app.getHttpServer())
        .post(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-template-enable')
        .send({ templateId, customName: '  Initial project template name  ' })
        .expect(201);
      projectTemplateId = enableResponse.body.data.id as string;
      expect(enableResponse.body.data).toMatchObject({
        projectId,
        templateId,
        customName: 'Initial project template name',
        isActive: true
      });

      const bossList = await request(app.getHttpServer())
        .get(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(bossList.body.data).toHaveLength(1);
      expect(bossList.body.data[0]).toMatchObject({
        id: projectTemplateId,
        template: { id: templateId, name: `${TEST_USER_PREFIX}project_template_template` }
      });

      await request(app.getHttpServer())
        .get(`/api/templates/${templateId}/fields`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      for (const role of ['employee', 'reviewer']) {
        await request(app.getHttpServer())
          .get(`/api/templates/${templateId}/fields`)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
      }

      await request(app.getHttpServer())
        .post(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ templateId })
        .expect(409);
      await expect(
        prisma.projectTemplate.count({ where: { projectId, templateId } })
      ).resolves.toBe(1);

      await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ isActive: false })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ customName: '   ' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ customName: 'Boss cannot rename' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-template-rename')
        .send({ customName: '  Renamed project template  ' })
        .expect(200)
        .expect(({ body }) => expect(body.data.customName).toBe('Renamed project template'));

      await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}/disable`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-template-disable')
        .expect(200)
        .expect(({ body }) => expect(body.data.isActive).toBe(false));
      await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}/disable`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-template-disable-duplicate')
        .expect(200)
        .expect(({ body }) => expect(body.data.isActive).toBe(false));

      const inactiveList = await request(app.getHttpServer())
        .get(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(inactiveList.body.data[0]).toMatchObject({ id: projectTemplateId, isActive: false });

      const reenableResponse = await request(app.getHttpServer())
        .post(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-project-template-reenable')
        .send({ templateId })
        .expect(201);
      expect(reenableResponse.body.data).toMatchObject({
        id: projectTemplateId,
        customName: 'Renamed project template',
        isActive: true
      });

      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);

      const archivedEnable = await request(app.getHttpServer())
        .post(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ templateId })
        .expect(409);
      expect(archivedEnable.body.message).toContain('归档项目');

      const archivedRename = await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ customName: 'Archived project rename' })
        .expect(409);
      expect(archivedRename.body.message).toContain('归档项目');

      const archivedDisable = await request(app.getHttpServer())
        .patch(`/api/project-templates/${projectTemplateId}/disable`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(409);
      expect(archivedDisable.body.message).toContain('归档项目');

      const audits = await prisma.auditLog.findMany({
        where: { resourceType: 'project_template', resourceId: projectTemplateId },
        orderBy: { createdAt: 'asc' }
      });
      expect(audits.map((audit) => [audit.action, audit.actorUsername, audit.requestId])).toEqual([
        ['project_template.enable', 'finance', 'integration-project-template-enable'],
        ['project_template.update', 'finance', 'integration-project-template-rename'],
        ['project_template.disable', 'finance', 'integration-project-template-disable'],
        ['project_template.enable', 'finance', 'integration-project-template-reenable']
      ]);
    } finally {
      const resourceIds = [projectId, templateId, projectTemplateId].filter((id): id is string => Boolean(id));
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      if (resourceIds.length) await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
    }
  });

  it('serializes project-template lifecycle changes with the project write lock', async () => {
    const financeLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const financeToken = financeLogin.body.data.accessToken as string;
    const suffix = randomUUID();
    const project = await prisma.project.create({
      data: {
        name: `${TEST_USER_PREFIX}template_lock_${suffix}`,
        customerName: 'Template lock customer',
        ownerName: 'Template lock owner',
        createdBy: 'finance'
      }
    });
    const template = await prisma.template.create({
      data: {
        name: `${TEST_USER_PREFIX}template_lock_${suffix}`,
        recordType: DataRecordType.cost,
        createdBy: 'finance'
      }
    });
    const binding = await prisma.projectTemplate.create({
      data: {
        projectId: project.id,
        templateId: template.id,
        recordType: DataRecordType.cost,
        customName: 'Template lock binding'
      }
    });
    let releaseLock: (() => void) | undefined;
    let announceLock: (() => void) | undefined;
    const lockHeld = new Promise<void>((resolve) => { announceLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${project.id}, 22))`;
      announceLock?.();
      await new Promise<void>((resolve) => { releaseLock = resolve; });
    }, { timeout: 10_000 });

    try {
      await lockHeld;
      const disablePromise = request(app.getHttpServer())
        .patch(`/api/project-templates/${binding.id}/disable`)
        .set('Authorization', `Bearer ${financeToken}`)
        .then((response) => response);
      const state = await Promise.race([
        disablePromise.then(() => 'settled' as const),
        new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 200))
      ]);
      expect(state).toBe('waiting');
      releaseLock?.();
      await blocker;
      const disabled = await disablePromise;
      expect(disabled.status).toBe(200);
      expect(disabled.body.data.isActive).toBe(false);
    } finally {
      releaseLock?.();
      await blocker.catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: project.id } });
      await prisma.template.deleteMany({ where: { id: template.id } });
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: [project.id, template.id, binding.id] } } });
    }
  });

  it('fails a blocked project-template lifecycle write with a stable retryable conflict', async () => {
    const financeLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const financeToken = financeLogin.body.data.accessToken as string;
    const suffix = randomUUID();
    const project = await prisma.project.create({
      data: {
        name: `${TEST_USER_PREFIX}template_timeout_${suffix}`,
        customerName: 'Template timeout customer',
        ownerName: 'Template timeout owner',
        createdBy: 'finance'
      }
    });
    const template = await prisma.template.create({
      data: {
        name: `${TEST_USER_PREFIX}template_timeout_${suffix}`,
        recordType: DataRecordType.cost,
        createdBy: 'finance'
      }
    });
    const binding = await prisma.projectTemplate.create({
      data: {
        projectId: project.id,
        templateId: template.id,
        recordType: DataRecordType.cost,
        customName: 'Template timeout binding'
      }
    });
    let releaseLock: (() => void) | undefined;
    let announceLock: (() => void) | undefined;
    const lockHeld = new Promise<void>((resolve) => { announceLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${project.id}, 22))`;
      announceLock?.();
      await new Promise<void>((resolve) => { releaseLock = resolve; });
    }, { timeout: 10_000 });

    try {
      await lockHeld;
      const startedAt = Date.now();
      const response = await request(app.getHttpServer())
        .patch(`/api/project-templates/${binding.id}/disable`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(409);
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(1_800);
      expect(elapsedMs).toBeLessThan(4_500);
      expect(response.body).toEqual({
        code: 40901,
        message: '项目正在被其他请求修改，请稍后重试',
        data: {
          reason: 'PROJECT_WRITE_LOCK_RETRY',
          retryable: true
        }
      });
      expect(await prisma.projectTemplate.findUniqueOrThrow({ where: { id: binding.id } }))
        .toMatchObject({ isActive: true });
      expect(await prisma.auditLog.count({
        where: { resourceType: 'project_template', resourceId: binding.id, action: 'project_template.disable' }
      })).toBe(0);
    } finally {
      releaseLock?.();
      await blocker.catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: project.id } });
      await prisma.template.deleteMany({ where: { id: template.id } });
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: [project.id, template.id, binding.id] } } });
    }
  });

  it('enforces business-record values, filters, lifecycle idempotency, and archived-project boundaries', async () => {
    const logins = await Promise.all(
      ['finance', 'boss', 'employee', 'reviewer'].map(async (username) => {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username, password: '123456' })
          .expect(200);
        return [username, response.body.data.accessToken as string] as const;
      })
    );
    const tokens = Object.fromEntries(logins) as Record<string, string>;
    let projectId: string | undefined;
    let templateId: string | undefined;
    const fieldIds: string[] = [];
    const recordIds: string[] = [];
    let projectTemplateId: string | undefined;

    try {
      const projectResponse = await request(app.getHttpServer())
        .post('/api/projects')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          name: `${TEST_USER_PREFIX}record_project`,
          customerName: 'Record customer',
          ownerName: 'Record owner'
        })
        .expect(201);
      projectId = projectResponse.body.data.id as string;

      const templateResponse = await request(app.getHttpServer())
        .post('/api/templates')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ name: `${TEST_USER_PREFIX}record_template`, recordType: DataRecordType.cost })
        .expect(201);
      templateId = templateResponse.body.data.id as string;

      const createField = async (name: string, fieldType: FieldType, semanticType: SemanticType) => {
        const response = await request(app.getHttpServer())
          .post('/api/fields')
          .set('Authorization', `Bearer ${tokens.finance}`)
          .send({ fieldName: `${TEST_USER_PREFIX}${name}`, fieldType, semanticType })
          .expect(201);
        const id = response.body.data.id as string;
        fieldIds.push(id);
        return id;
      };
      const amountFieldId = await createField('record_amount', FieldType.money, SemanticType.amount);
      const dateFieldId = await createField('record_date', FieldType.date, SemanticType.date);
      const noteFieldId = await createField('record_note', FieldType.text, SemanticType.remark);

      for (const [index, fieldId] of [amountFieldId, dateFieldId, noteFieldId].entries()) {
        await request(app.getHttpServer())
          .post(`/api/templates/${templateId}/fields`)
          .set('Authorization', `Bearer ${tokens.finance}`)
          .send({ fieldId, displayOrder: index + 1, isRequired: index < 2 })
          .expect(201);
      }
      await request(app.getHttpServer())
        .patch(`/api/templates/${templateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ primaryAmountFieldId: amountFieldId, primaryDateFieldId: dateFieldId })
        .expect(200);

      const relationResponse = await request(app.getHttpServer())
        .post(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ templateId, customName: 'Record lifecycle template' })
        .expect(201);
      projectTemplateId = relationResponse.body.data.id as string;

      for (const role of ['employee', 'reviewer']) {
        await request(app.getHttpServer())
          .get('/api/records')
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
      }

      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          projectId,
          templateId,
          recordType: DataRecordType.cost,
          recordDate: '2026-07-10',
          amount: 1,
          values: [],
          createdBy: 'forged-user',
          confirmedBy: 'forged-user'
        })
        .expect(400);

      const createRecord = async (
        recordDate: string,
        amount: string,
        status: BusinessRecordStatus,
        note: string,
        requestId: string
      ) => {
        const response = await request(app.getHttpServer())
          .post('/api/records')
          .set('Authorization', `Bearer ${tokens.finance}`)
          .set('X-Request-Id', requestId)
          .send({
            projectId,
            templateId,
            recordType: DataRecordType.cost,
            recordDate,
            amount,
            category: '成本',
            sourceType: RecordSourceType.manual,
            sourceId: 'manual',
            status,
            values: [
              { fieldId: amountFieldId, value: amount },
              { fieldId: dateFieldId, value: recordDate },
              { fieldId: noteFieldId, value: note }
            ],
            attachments: []
          })
          .expect(201);
        const id = response.body.data.id as string;
        recordIds.push(id);
        expect(response.body.data.createdBy).toBe('finance');
        return response.body.data as { id: string };
      };

      const first = await createRecord(
        '2026-07-10',
        '123.45',
        BusinessRecordStatus.draft,
        'first record',
        'integration-record-create-first'
      );
      const second = await createRecord(
        '2026-07-11',
        '678.90',
        BusinessRecordStatus.pending_confirm,
        'second record',
        'integration-record-create-second'
      );

      const storedValues = await prisma.recordValue.findMany({ where: { recordId: first.id } });
      expect(storedValues.find((value) => value.fieldId === amountFieldId)?.valueNumber?.toString()).toBe('123.45');
      expect(storedValues.find((value) => value.fieldId === dateFieldId)?.valueDate?.toISOString()).toBe('2026-07-10T00:00:00.000Z');
      expect(storedValues.find((value) => value.fieldId === noteFieldId)?.valueText).toBe('first record');

      const paged = await request(app.getHttpServer())
        .get(`/api/records?projectId=${projectId}&page=1&pageSize=1`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(paged.body.data).toMatchObject({ page: 1, pageSize: 1, total: 2 });
      expect(paged.body.data.items).toHaveLength(1);

      const inclusiveDate = await request(app.getHttpServer())
        .get(`/api/records?projectId=${projectId}&dateFrom=2026-07-11&dateTo=2026-07-11`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(inclusiveDate.body.data.items.map((record: { id: string }) => record.id)).toEqual([second.id]);

      await request(app.getHttpServer())
        .get(`/api/records?dateFrom=2026-07-12&dateTo=2026-07-11`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/records?dataLayer=forged')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);

      const projectRecords = await request(app.getHttpServer())
        .get(`/api/projects/${projectId}/records?page=1&pageSize=20`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(projectRecords.body.data.total).toBe(2);
      await request(app.getHttpServer())
        .get(`/api/records/${first.id}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/records/${first.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ status: BusinessRecordStatus.confirmed })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/records/${first.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ recordType: DataRecordType.revenue })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/records/${first.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({})
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/records/${first.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-record-update')
        .send({ amount: '222.22', description: '  updated record  ' })
        .expect(200)
        .expect(({ body }) => expect(body.data).toMatchObject({ amount: '222.22', description: 'updated record' }));

      await request(app.getHttpServer())
        .post(`/api/records/${first.id}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-record-confirm')
        .expect(201)
        .expect(({ body }) => expect(body.data).toMatchObject({ status: BusinessRecordStatus.confirmed, confirmedBy: 'finance' }));
      await request(app.getHttpServer())
        .post(`/api/records/${first.id}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-record-confirm-duplicate')
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/records/${first.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ description: 'cannot update confirmed' })
        .expect(409);

      const secondBeforeVoid = await prisma.businessRecord.findUniqueOrThrow({
        where: { id: second.id },
        include: { values: true }
      });
      await request(app.getHttpServer())
        .delete(`/api/records/${second.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-record-void')
        .expect(200)
        .expect(({ body }) => expect(body.data.status).toBe(BusinessRecordStatus.rejected));
      await request(app.getHttpServer())
        .delete(`/api/records/${second.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-record-void-duplicate')
        .expect(200);
      const secondAfterVoid = await prisma.businessRecord.findUniqueOrThrow({
        where: { id: second.id },
        include: { values: true }
      });
      expect(secondAfterVoid).toMatchObject({
        status: BusinessRecordStatus.rejected,
        amount: secondBeforeVoid.amount,
        sourceSnapshot: secondBeforeVoid.sourceSnapshot,
        templateSnapshot: secondBeforeVoid.templateSnapshot,
        attachments: secondBeforeVoid.attachments
      });
      expect(secondAfterVoid.values).toHaveLength(secondBeforeVoid.values.length);
      expect(secondAfterVoid.voidedAt).toBeInstanceOf(Date);
      expect(secondAfterVoid.confirmedAt).toBeNull();
      await request(app.getHttpServer())
        .post(`/api/records/${second.id}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(409);
      await request(app.getHttpServer())
        .patch(`/api/records/${second.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ description: 'cannot update voided' })
        .expect(409);

      const third = await createRecord(
        '2026-07-12',
        '50.00',
        BusinessRecordStatus.pending_confirm,
        'archived boundary record',
        'integration-record-create-third'
      );
      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/api/records/${third.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          projectId,
          templateId,
          recordType: DataRecordType.cost,
          recordDate: '2026-07-13',
          amount: '1.00',
          values: []
        })
        .expect(409);
      await request(app.getHttpServer())
        .patch(`/api/records/${third.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ description: 'archived update' })
        .expect(409);
      await request(app.getHttpServer())
        .post(`/api/records/${third.id}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/api/records/${third.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);

      const recordAudits = await prisma.auditLog.findMany({
        where: { resourceType: 'business_record', resourceId: { in: recordIds } }
      });
      expect(recordAudits.filter((audit) => audit.action === 'business_record.confirm' && audit.resourceId === first.id)).toHaveLength(1);
      expect(recordAudits.filter((audit) => audit.action === 'business_record.void' && audit.resourceId === second.id)).toHaveLength(1);
      expect(recordAudits.map((audit) => [audit.action, audit.actorUsername, audit.requestId])).toEqual(
        expect.arrayContaining([
          ['business_record.update', 'finance', 'integration-record-update'],
          ['business_record.confirm', 'finance', 'integration-record-confirm'],
          ['business_record.void', 'finance', 'integration-record-void']
        ])
      );

      const ledgerEvents = await prisma.ledgerEvent.findMany({
        where: { aggregateType: 'business_record', aggregateId: { in: recordIds } }
      });
      expect(ledgerEvents.filter((event) => event.eventType === 'business_record_confirmed' && event.aggregateId === first.id)).toHaveLength(1);
      expect(ledgerEvents.filter((event) => event.eventType === 'business_record_voided' && event.aggregateId === second.id)).toHaveLength(1);
    } finally {
      if (recordIds.length) {
        await prisma.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: recordIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateType: 'business_record', aggregateId: { in: recordIds } } });
      }
      const resourceIds = [projectId, templateId, projectTemplateId, ...fieldIds].filter((id): id is string => Boolean(id));
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      if (fieldIds.length) await prisma.fieldDefinition.deleteMany({ where: { id: { in: fieldIds } } });
      if (resourceIds.length) await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
    }
  });

  it('enforces manual-entry source, draft, required-field and dynamic-value boundaries in PostgreSQL', async () => {
    const financeLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const financeToken = financeLogin.body.data.accessToken as string;
    const financeUserId = financeLogin.body.data.user.id as string;
    const suffix = Date.now().toString(36);
    let projectId: string | undefined;
    let templateId: string | undefined;
    const fieldIds: string[] = [];
    const recordIds: string[] = [];

    try {
      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}manual_${suffix}`,
          customerName: 'Manual customer',
          ownerName: 'Manual owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;
      const template = await prisma.template.create({
        data: {
          name: `${TEST_USER_PREFIX}manual_template_${suffix}`,
          recordType: DataRecordType.cost,
          dataLayer: RecordDataLayer.reconciliation,
          createdBy: 'finance'
        }
      });
      templateId = template.id;

      const createField = async (key: string, name: string, fieldType: FieldType, semanticType: SemanticType) => {
        const field = await prisma.fieldDefinition.create({
          data: {
            fieldKey: `${TEST_USER_PREFIX}${key}_${suffix}`,
            fieldName: name,
            fieldType,
            semanticType,
            aliases: []
          }
        });
        fieldIds.push(field.id);
        return field;
      };
      const amountField = await createField('manual_amount', '手工金额', FieldType.money, SemanticType.amount);
      const dateField = await createField('manual_date', '手工日期', FieldType.date, SemanticType.date);
      const noteField = await createField('manual_note', '手工说明', FieldType.text, SemanticType.remark);
      await prisma.templateField.createMany({
        data: [amountField, dateField, noteField].map((field, index) => ({
          templateId: template.id,
          fieldId: field.id,
          isRequired: true,
          isVisible: true,
          displayOrder: index + 1
        }))
      });
      await prisma.template.update({
        where: { id: template.id },
        data: { primaryAmountFieldId: amountField.id, primaryDateFieldId: dateField.id }
      });
      await prisma.projectTemplate.create({
        data: { projectId: project.id, templateId: template.id, recordType: template.recordType }
      });

      const values = [
        { fieldId: amountField.id, value: '88.12' },
        { fieldId: dateField.id, value: '2026-07-15' },
        { fieldId: noteField.id, value: '真实手工补录' }
      ];
      const basePayload = {
        projectId: project.id,
        templateId: template.id,
        recordType: DataRecordType.cost,
        recordDate: '2026-07-15',
        amount: '88.12',
        sourceType: RecordSourceType.manual,
        sourceId: 'manual',
        values,
        attachments: []
      };

      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ...basePayload, sourceType: RecordSourceType.work_order })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ...basePayload, sourceId: 'forged-source' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ...basePayload, status: BusinessRecordStatus.confirmed })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ...basePayload, recordDate: '2026-02-30' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ...basePayload, amount: '88.123' })
        .expect(400);
      const negativeAmount = await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          ...basePayload,
          amount: '-1.00',
          values: values.map((value) => value.fieldId === amountField.id ? { ...value, value: '-1.00' } : value)
        })
        .expect(400);
      expect(negativeAmount.body.data.errors).toEqual(expect.arrayContaining([expect.stringContaining('H02')]));
      const zeroAmount = await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          ...basePayload,
          amount: '0.00',
          values: values.map((value) => value.fieldId === amountField.id ? { ...value, value: '0.00' } : value)
        })
        .expect(400);
      expect(zeroAmount.body.data).toMatchObject({
        reason: H02_POLICY_PENDING_REASON,
        decisionId: 'H02',
        policyVersion: 'financial-policy-baseline/1.0'
      });
      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ ...basePayload, status: BusinessRecordStatus.pending_confirm, values: [] })
        .expect(400);

      const draftResponse = await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('X-Request-Id', 'integration-manual-draft-create')
        .send({ ...basePayload, status: BusinessRecordStatus.draft, values: [] })
        .expect(201);
      const recordId = draftResponse.body.data.id as string;
      recordIds.push(recordId);
      expect(draftResponse.body.data).toMatchObject({
        createdBy: 'finance',
        sourceType: RecordSourceType.manual,
        sourceId: 'manual',
        status: BusinessRecordStatus.draft
      });

      await request(app.getHttpServer())
        .post(`/api/records/${recordId}/confirm`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/records/${recordId}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ values: [{ fieldId: amountField.id, value: '88.12345' }] })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/records/${recordId}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ values: [{ fieldId: dateField.id, value: '2026-02-30' }] })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/records/${recordId}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ values: [{ fieldId: noteField.id, value: { forged: true } }] })
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/records/${recordId}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('X-Request-Id', 'integration-manual-draft-complete')
        .send({ amount: '88.12', values })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/records/${recordId}/confirm`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('X-Request-Id', 'integration-manual-confirm')
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(BusinessRecordStatus.confirmed));

      const stored = await prisma.businessRecord.findUniqueOrThrow({ where: { id: recordId } });
      expect(stored.recordDate.toISOString()).toBe('2026-07-15T00:00:00.000Z');
      expect(stored.createdBy).toBe('finance');
      expect(stored.dataLayer).toBe(RecordDataLayer.reconciliation);
      expect(stored.templateSnapshot).toMatchObject({
        templateId,
        version: 1,
        accountingDirection: AccountingDirection.expense,
        dataLayer: RecordDataLayer.reconciliation
      });
      expect(stored.sourceSnapshot).toMatchObject({
        sourceType: RecordSourceType.manual,
        sourceId: 'manual',
        metadata: { createdByUserId: financeUserId }
      });
      expect(stored.confirmationSnapshot).toMatchObject({
        projectId,
        templateId,
        templateVersion: 1,
        accountingDirection: AccountingDirection.expense,
        dataLayer: RecordDataLayer.reconciliation,
        recordDate: '2026-07-15',
        amount: '88.12',
        sourceType: RecordSourceType.manual,
        sourceId: 'manual',
        confirmedBy: 'finance'
      });
      const reconciliationRecords = await request(app.getHttpServer())
        .get(`/api/records?projectId=${projectId}&dataLayer=${RecordDataLayer.reconciliation}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(reconciliationRecords.body.data).toMatchObject({ total: 1 });
      expect(reconciliationRecords.body.data.items[0]).toMatchObject({
        id: recordId,
        dataLayer: RecordDataLayer.reconciliation
      });
      const storedValues = await prisma.recordValue.findMany({ where: { recordId } });
      expect(storedValues.find((value) => value.fieldId === amountField.id)?.valueNumber?.toString()).toBe('88.12');
      expect(storedValues.find((value) => value.fieldId === dateField.id)?.valueDate?.toISOString()).toBe('2026-07-15T00:00:00.000Z');
      expect(storedValues.find((value) => value.fieldId === noteField.id)?.valueText).toBe('真实手工补录');

      const audits = await prisma.auditLog.findMany({ where: { resourceType: 'business_record', resourceId: recordId } });
      expect(audits.map((audit) => [audit.action, audit.actorUsername, audit.requestId])).toEqual(
        expect.arrayContaining([
          ['business_record.create', 'finance', 'integration-manual-draft-create'],
          ['business_record.update', 'finance', 'integration-manual-draft-complete'],
          ['business_record.confirm', 'finance', 'integration-manual-confirm']
        ])
      );
      expect(audits.filter((audit) => audit.action === 'business_record.confirm')).toHaveLength(1);
      const ledgerEvents = await prisma.ledgerEvent.findMany({
        where: { aggregateType: 'business_record', aggregateId: recordId }
      });
      expect(ledgerEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(['business_record_created', 'business_record_confirmed'])
      );
    } finally {
      if (recordIds.length) {
        await prisma.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: recordIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateType: 'business_record', aggregateId: { in: recordIds } } });
      }
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      if (fieldIds.length) await prisma.fieldDefinition.deleteMany({ where: { id: { in: fieldIds } } });
    }
  });

  it('preserves large decimal cents and serializes concurrent record transitions', async () => {
    const tokens = Object.fromEntries(await Promise.all(['finance', 'boss'].map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<'finance' | 'boss', string>;
    const template = await prisma.template.findUniqueOrThrow({
      where: { id: 'dt-reimbursement' },
      include: { templateFields: { include: { field: true } } }
    });
    const recordIds: string[] = [];
    const create = async (amount: string, date: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          projectId: 'dp-001',
          templateId: template.id,
          recordType: template.recordType,
          recordDate: date,
          amount,
          category: '成本',
          status: BusinessRecordStatus.pending_confirm,
          values: [
            { fieldId: template.primaryAmountFieldId, value: amount },
            { fieldId: template.primaryDateFieldId, value: date },
            ...template.templateFields
              .filter((item) => item.isRequired && ![template.primaryAmountFieldId, template.primaryDateFieldId].includes(item.fieldId))
              .map((item) => ({ fieldId: item.fieldId, value: `边界测试-${item.field.fieldKey}` }))
          ],
          attachments: []
        })
        .expect(201);
      recordIds.push(response.body.data.id as string);
      return response.body.data as { id: string; amount: string };
    };

    try {
      const large = await create('90071992547409.91', '2026-07-20');
      expect(large.amount).toBe('90071992547409.91');
      const fetched = await request(app.getHttpServer())
        .get(`/api/records/${large.id}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(fetched.body.data.amount).toBe('90071992547409.91');
      expect((await prisma.businessRecord.findUniqueOrThrow({ where: { id: large.id } })).amount.toString())
        .toBe('90071992547409.91');

      const confirm = () => request(app.getHttpServer())
        .post(`/api/records/${large.id}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`);
      const voidRecord = () => request(app.getHttpServer())
        .delete(`/api/records/${large.id}`)
        .set('Authorization', `Bearer ${tokens.finance}`);
      const transitionResponses = await Promise.all([confirm(), voidRecord()]);
      expect(transitionResponses.filter((response) => response.status === 409)).toHaveLength(1);
      expect(transitionResponses.filter((response) => [200, 201].includes(response.status))).toHaveLength(1);
      const terminal = await prisma.businessRecord.findUniqueOrThrow({ where: { id: large.id } });
      expect(Boolean(terminal.confirmedAt)).not.toBe(Boolean(terminal.voidedAt));
      expect(await prisma.ledgerEvent.count({
        where: {
          aggregateId: large.id,
          eventType: { in: ['business_record_confirmed', 'business_record_voided'] }
        }
      })).toBe(1);

      const duplicateConfirm = await create('0.01', '2026-07-21');
      const duplicateResponses = await Promise.all([
        request(app.getHttpServer()).post(`/api/records/${duplicateConfirm.id}/confirm`).set('Authorization', `Bearer ${tokens.finance}`),
        request(app.getHttpServer()).post(`/api/records/${duplicateConfirm.id}/confirm`).set('Authorization', `Bearer ${tokens.finance}`)
      ]);
      expect(duplicateResponses.map((response) => response.status)).toEqual([201, 201]);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: duplicateConfirm.id, eventType: 'business_record_confirmed' }
      })).toBe(1);
      expect(await prisma.auditLog.count({
        where: { resourceId: duplicateConfirm.id, action: 'business_record.confirm' }
      })).toBe(1);
    } finally {
      if (recordIds.length) {
        await prisma.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: recordIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: recordIds } } });
      }
    }
  });

  it('runs the complete work-order state machine with ownership, recovery, idempotency, and record generation', async () => {
    const roles = ['employee', '员工', 'finance', 'reviewer', 'boss'] as const;
    const logins = await Promise.all(
      roles.map(async (username) => {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ username, password: '123456' })
          .expect(200);
        return [username, response.body.data.accessToken as string] as const;
      })
    );
    const tokens = Object.fromEntries(logins) as Record<(typeof roles)[number], string>;
    const employee = await prisma.user.findUniqueOrThrow({ where: { username: 'employee' } });
    const suffix = Date.now().toString(36);
    let projectId: string | undefined;
    let templateId: string | undefined;
    let rawFileId: string | undefined;
    let workOrderId: string | undefined;
    let crossActorWorkOrderId: string | undefined;
    let raceWorkOrderId: string | undefined;
    let generatedRecordId: string | undefined;

    try {
      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}work_order_${suffix}`,
          customerName: 'Workflow customer',
          ownerName: 'Workflow owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;
      const template = await prisma.template.create({
        data: {
          name: `${TEST_USER_PREFIX}work_order_template_${suffix}`,
          recordType: DataRecordType.reimbursement,
          createdBy: 'finance'
        }
      });
      templateId = template.id;
      const standardFields = await prisma.fieldDefinition.findMany({
        where: { fieldKey: { in: ['date', 'amount', 'expenseReason', 'attachment'] } }
      });
      expect(standardFields).toHaveLength(4);
      await prisma.templateField.createMany({
        data: standardFields.map((field, index) => ({
          templateId: template.id,
          fieldId: field.id,
          displayOrder: index + 1,
          isVisible: true,
          isRequired: field.fieldKey !== 'attachment'
        }))
      });
      const amountField = standardFields.find((field) => field.fieldKey === 'amount')!;
      const dateField = standardFields.find((field) => field.fieldKey === 'date')!;
      await prisma.template.update({
        where: { id: template.id },
        data: { primaryAmountFieldId: amountField.id, primaryDateFieldId: dateField.id }
      });
      await prisma.projectTemplate.create({
        data: { projectId: project.id, templateId: template.id, recordType: template.recordType }
      });
      const rawFile = await prisma.rawFile.create({
        data: {
          fileName: `${suffix}.pdf`,
          originalFileName: 'supplement.pdf',
          fileType: 'pdf',
          mimeType: 'application/pdf',
          fileSize: BigInt(128),
          storagePath: `integration/${suffix}.pdf`,
          sha256: suffix.padEnd(64, '0').slice(0, 64),
          scanStatus: FileScanStatus.clean,
          uploadedBy: employee.id,
          relatedProjectId: project.id
        }
      });
      rawFileId = rawFile.id;

      const creationKey = `integration-create-${suffix}`;
      const createDraft = () => request(app.getHttpServer())
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('Idempotency-Key', creationKey)
        .set('X-Request-Id', `integration-work-order-create-${suffix}`)
        .send({ type: WorkOrderType.expense, projectId: project.id });
      const firstCreate = await createDraft().expect(201);
      const repeatedCreate = await createDraft().expect(201);
      workOrderId = firstCreate.body.data.id as string;
      expect(repeatedCreate.body.data.id).toBe(workOrderId);
      expect(firstCreate.body.data).toMatchObject({
        status: WorkOrderStatus.draft,
        creatorId: employee.id,
        amount: '0.00'
      });

      const crossActorCreate = await request(app.getHttpServer())
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${tokens['员工']}`)
        .set('Idempotency-Key', creationKey)
        .send({ type: WorkOrderType.expense, projectId: project.id })
        .expect(201);
      crossActorWorkOrderId = crossActorCreate.body.data.id as string;
      expect(crossActorWorkOrderId).not.toBe(workOrderId);
      expect(crossActorCreate.body.data.creatorId).not.toBe(employee.id);

      const raceCreate = await request(app.getHttpServer())
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('Idempotency-Key', `integration-work-order-race-${suffix}`)
        .send({
          type: WorkOrderType.expense,
          projectId: project.id,
          amount: '100.00',
          description: '并发提交快照测试',
          occurredDate: '2026-07-17'
        })
        .expect(201);
      raceWorkOrderId = raceCreate.body.data.id as string;
      const [racePatch, raceSubmit] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/work-orders/${raceWorkOrderId}`)
          .set('Authorization', `Bearer ${tokens.employee}`)
          .send({ amount: '200.00' }),
        request(app.getHttpServer())
          .post(`/api/work-orders/${raceWorkOrderId}/submit`)
          .set('Authorization', `Bearer ${tokens.employee}`)
      ]);
      expect(raceSubmit.status).toBe(201);
      expect([200, 409]).toContain(racePatch.status);
      const storedRaceWorkOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: raceWorkOrderId } });
      expect(storedRaceWorkOrder.status).toBe(WorkOrderStatus.finance_reviewing);
      expect((storedRaceWorkOrder.submissionSnapshot as { amount: string }).amount)
        .toBe(storedRaceWorkOrder.amount.toFixed(2));

      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/submit`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(422);
      await request(app.getHttpServer())
        .patch(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .send({ creatorId: 'forged-user', status: WorkOrderStatus.completed })
        .expect(400);
      const updateKey = `integration-work-order-update-${suffix}`;
      const updateDraft = (description = '  PostgreSQL workflow expense  ') => request(app.getHttpServer())
        .patch(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('Idempotency-Key', updateKey)
        .set('X-Request-Id', `integration-work-order-update-${suffix}`)
        .send({
          amount: '2450.50',
          description,
          occurredDate: '2026-07-18',
          extraValues: { expenseType: '人工' }
        });
      const firstUpdate = await updateDraft().expect(200);
      const replayedUpdate = await updateDraft().expect(200);
      expect(replayedUpdate.body).toEqual(firstUpdate.body);
      await updateDraft('同键不能改变工单草稿').expect(409).expect(({ body }) => {
        expect(body.data.reason).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
      });
      expect(firstUpdate.body.data.description).toBe('PostgreSQL workflow expense');
      expect(await prisma.auditLog.count({
        where: { resourceId: workOrderId, action: 'work_order.update' }
      })).toBe(1);
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/submit`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('X-Request-Id', `integration-work-order-submit-${suffix}`)
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(WorkOrderStatus.finance_reviewing));
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/submit`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(422);

      await request(app.getHttpServer())
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${tokens['员工']}`)
        .expect(403);
      const otherEmployeeList = await request(app.getHttpServer())
        .get('/api/work-orders?page=1&pageSize=100')
        .set('Authorization', `Bearer ${tokens['员工']}`)
        .expect(200);
      expect(otherEmployeeList.body.data.items.map((item: { id: string }) => item.id)).not.toContain(workOrderId);
      await request(app.getHttpServer())
        .get(`/api/work-orders?status=${WorkOrderStatus.finance_reviewing}`)
        .set('Authorization', `Bearer ${tokens.reviewer}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/work-orders?status=${WorkOrderStatus.finance_reviewing}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/finance-review`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ action: 'supplement' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/finance-review`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ action: 'supplement', comment: '请补充付款凭证' })
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(WorkOrderStatus.returned_for_supplement));
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/supplement`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('X-Request-Id', `integration-work-order-supplement-${suffix}`)
        .send({
          comment: '已补充付款凭证并重新提交',
          description: 'PostgreSQL workflow expense with voucher',
          attachments: [rawFile.id]
        })
        .expect(201)
        .expect(({ body }) => {
          expect(body.data.status).toBe(WorkOrderStatus.finance_reviewing);
          expect(body.data.attachments).toContain(rawFile.id);
        });

      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/finance-review`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ action: 'approve', comment: '财务复审通过' })
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(WorkOrderStatus.reviewer_reviewing));
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/reviewer-review`)
        .set('Authorization', `Bearer ${tokens.reviewer}`)
        .send({ action: 'reject_to_finance', comment: '金额归类需要财务复核' })
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(WorkOrderStatus.reviewer_rejected));
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/reviewer-review`)
        .set('Authorization', `Bearer ${tokens.reviewer}`)
        .send({ action: 'approve' })
        .expect(422);
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/finance-review`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ action: 'approve', comment: '复核退回后财务重新通过' })
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(WorkOrderStatus.reviewer_reviewing));

      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/reviewer-review`)
        .set('Authorization', `Bearer ${tokens.reviewer}`)
        .send({ action: 'approve', comment: '复核通过，进入规则复核' })
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(WorkOrderStatus.boss_pending));
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/ai-review`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(WorkOrderStatus.boss_pending));

      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/boss-approve`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ action: 'approve', comment: '老板通过' })
        .expect(400);
      const approvalKey = `integration-approve-${suffix}`;
      const approve = () => request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/boss-approve`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .set('Idempotency-Key', approvalKey)
        .set('X-Request-Id', `integration-work-order-boss-${suffix}`)
        .send({ action: 'approve', comment: '老板通过并归档' });
      const [firstApproval, secondApproval] = await Promise.all([approve(), approve()]);
      expect([firstApproval.status, secondApproval.status]).toEqual([201, 201]);
      expect(firstApproval.body.data.id).toBe(workOrderId);
      expect(secondApproval.body.data.id).toBe(workOrderId);
      expect(firstApproval.body.data.status).toBe(WorkOrderStatus.completed);
      generatedRecordId = firstApproval.body.data.generatedRecordId as string;
      expect(generatedRecordId).toBeTruthy();
      expect(secondApproval.body.data.generatedRecordId).toBe(generatedRecordId);
      expect(secondApproval.body).toEqual(firstApproval.body);
      await request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/boss-approve`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .set('Idempotency-Key', approvalKey)
        .send({ action: 'reject', comment: '同键改变审批动作' })
        .expect(409);

      const storedWorkOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
      expect(storedWorkOrder).toMatchObject({
        creatorId: employee.id,
        creationIdempotencyKey: expect.stringMatching(/^idem-v1:[a-f0-9]{64}$/),
        approvalIdempotencyKey: expect.stringMatching(/^idem-v1:[a-f0-9]{64}$/),
        status: WorkOrderStatus.completed,
        generatedRecordId
      });
      expect(storedWorkOrder.creationIdempotencyKey).not.toContain(creationKey);
      expect(storedWorkOrder.approvalIdempotencyKey).not.toContain(approvalKey);
      expect(storedWorkOrder.occurredDate?.toISOString()).toBe('2026-07-18T00:00:00.000Z');
      expect(await prisma.businessRecord.count({
        where: { sourceType: RecordSourceType.work_order, sourceId: workOrderId }
      })).toBe(1);
      const generatedRecord = await prisma.businessRecord.findUniqueOrThrow({ where: { id: generatedRecordId } });
      expect(generatedRecord.templateSnapshot).toMatchObject({
        templateId,
        version: 1,
        accountingDirection: AccountingDirection.expense
      });
      expect(generatedRecord.sourceSnapshot).toMatchObject({
        sourceType: RecordSourceType.work_order,
        sourceId: workOrderId,
        metadata: { workOrderId, submissionSnapshot: { workOrderId } }
      });
      expect(generatedRecord.confirmationSnapshot).toMatchObject({
        projectId,
        templateId,
        amount: '2450.50',
        recordDate: '2026-07-18',
        sourceType: RecordSourceType.work_order,
        sourceId: workOrderId,
        confirmedBy: 'boss'
      });
      expect(await prisma.approval.count({
        where: { workOrderId, approverRole: UserRole.boss }
      })).toBe(1);
      expect(await prisma.auditLog.count({
        where: { resourceType: 'work_order', resourceId: workOrderId, action: 'work_order.create' }
      })).toBe(1);
      expect(await prisma.auditLog.count({
        where: { resourceType: 'work_order', resourceId: workOrderId, action: 'work_order.boss_approve' }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateType: 'business_record', aggregateId: generatedRecordId, eventType: 'business_record_created' }
      })).toBe(1);
      const timeline = await prisma.workOrderTimeline.findMany({ where: { workOrderId }, orderBy: { createdAt: 'asc' } });
      const timelineStatuses = timeline.map((item) => item.toStatus);
      expect(timelineStatuses).toEqual(
        expect.arrayContaining([
          WorkOrderStatus.draft,
          WorkOrderStatus.finance_reviewing,
          WorkOrderStatus.returned_for_supplement,
          WorkOrderStatus.reviewer_rejected,
          WorkOrderStatus.boss_pending,
          WorkOrderStatus.completed
        ])
      );
      expect(
        timelineStatuses.some(
          (status) => status === WorkOrderStatus.ai_passed || status === WorkOrderStatus.ai_flagged
        )
      ).toBe(true);
    } finally {
      await prisma.idempotencyKey.deleteMany({ where: { key: { contains: suffix } } });
      const workOrderIds = [workOrderId, crossActorWorkOrderId, raceWorkOrderId]
        .filter((id): id is string => Boolean(id));
      if (workOrderIds.length) await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
      const projectRecordIds = projectId
        ? (await prisma.businessRecord.findMany({ where: { projectId }, select: { id: true } })).map((record) => record.id)
        : [];
      const resourceIds = [...workOrderIds, generatedRecordId, ...projectRecordIds].filter((id): id is string => Boolean(id));
      if (projectRecordIds.length) await prisma.businessRecord.deleteMany({ where: { id: { in: projectRecordIds } } });
      if (resourceIds.length) await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
      if (resourceIds.length) {
        await prisma.ledgerEvent.deleteMany({
          where: {
            OR: [
              { aggregateType: 'work_order', aggregateId: { in: resourceIds } },
              { aggregateType: 'business_record', aggregateId: { in: resourceIds } }
            ]
          }
        });
      }
      if (rawFileId) await prisma.rawFile.deleteMany({ where: { id: rawFileId } });
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
    }
  });

  it('stores, authorizes, streams, retains, and audits real file content', async () => {
    const roles = ['employee', '员工', 'finance', 'reviewer', 'boss'] as const;
    const tokens = Object.fromEntries(await Promise.all(roles.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof roles)[number], string>;
    const suffix = Date.now().toString(36);
    const rawFileIds: string[] = [];
    const storagePaths: string[] = [];
    const workOrderIds: string[] = [];
    const recordIds: string[] = [];
    let projectId: string | undefined;
    let secondProjectId: string | undefined;
    let templateId: string | undefined;

    const validPdfDocument = await PDFDocument.create();
    validPdfDocument.addPage([320, 240]);
    const validPdf = Buffer.from(await validPdfDocument.save());
    const upload = (token: string, targetProjectId: string, file: Buffer, options: {
      name?: string;
      mimeType?: string;
      workOrderId?: string;
      requestId?: string;
      idempotencyKey?: string;
    } = {}) => {
      const uploadRequest = request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', options.requestId ?? `integration-file-${suffix}`)
        .field('relatedProjectId', targetProjectId);
      if (options.idempotencyKey) uploadRequest.set('Idempotency-Key', options.idempotencyKey);
      if (options.workOrderId) uploadRequest.field('workOrderId', options.workOrderId);
      return uploadRequest.attach('file', file, {
        filename: options.name ?? 'voucher.pdf',
        contentType: options.mimeType ?? 'application/pdf'
      });
    };

    try {
      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}files_${suffix}`,
          customerName: 'File customer',
          ownerName: 'File owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;
      const secondProject = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}files_other_${suffix}`,
          customerName: 'Other file customer',
          ownerName: 'Other file owner',
          createdBy: 'finance'
        }
      });
      secondProjectId = secondProject.id;
      const template = await prisma.template.create({
        data: {
          name: `${TEST_USER_PREFIX}files_template_${suffix}`,
          recordType: DataRecordType.reimbursement,
          createdBy: 'finance'
        }
      });
      templateId = template.id;
      const recordFields = await prisma.fieldDefinition.findMany({
        where: { fieldKey: { in: ['date', 'amount'] } }
      });
      const recordAmountField = recordFields.find((field) => field.fieldKey === 'amount')!;
      const recordDateField = recordFields.find((field) => field.fieldKey === 'date')!;
      await prisma.templateField.createMany({
        data: recordFields.map((field, index) => ({
          templateId: template.id,
          fieldId: field.id,
          displayOrder: index + 1,
          isRequired: true,
          isVisible: true
        }))
      });
      await prisma.template.update({
        where: { id: template.id },
        data: { primaryAmountFieldId: recordAmountField.id, primaryDateFieldId: recordDateField.id }
      });
      await prisma.projectTemplate.createMany({
        data: [project.id, secondProject.id].map((targetProjectId) => ({
          projectId: targetProjectId,
          templateId: template.id,
          recordType: template.recordType
        }))
      });

      const draftResponse = await request(app.getHttpServer())
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('Idempotency-Key', `integration-file-work-order-${suffix}`)
        .send({ type: WorkOrderType.expense, projectId: project.id })
        .expect(201);
      const workOrderId = draftResponse.body.data.id as string;
      workOrderIds.push(workOrderId);

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .field('relatedProjectId', project.id)
        .attach('file', validPdf, { filename: 'no-auth.pdf', contentType: 'application/pdf' })
        .expect(401);
      await upload(tokens.employee, project.id, validPdf).expect(403);
      await upload(tokens.finance, project.id, validPdf, { workOrderId }).expect(403);
      await upload(tokens['员工'], project.id, validPdf, { workOrderId }).expect(403);
      await upload(tokens.employee, project.id, Buffer.from('not-a-pdf'), {
        workOrderId,
        name: 'forged.pdf',
        mimeType: 'application/pdf'
      }).expect(400);
      await upload(tokens.employee, project.id, validPdf, {
        workOrderId,
        name: 'wrong-mime.pdf',
        mimeType: 'text/plain'
      }).expect(400);
      await upload(tokens.employee, project.id, Buffer.alloc(0), {
        workOrderId,
        name: 'empty.pdf'
      }).expect(400);
      await upload(tokens.employee, project.id, Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), {
        workOrderId,
        name: 'eicar.csv',
        mimeType: 'text/csv'
      }).expect(422);
      const oversizedPdf = Buffer.concat([
        Buffer.from('%PDF-1.4\n'),
        Buffer.alloc(5 * 1024 * 1024, 0x20),
        Buffer.from('\n%%EOF')
      ]);
      await upload(tokens.employee, project.id, oversizedPdf, {
        workOrderId,
        name: 'oversized.pdf'
      }).expect(413);

      const uploadIdempotencyKey = `integration-file-upload-${suffix}`;
      const uploadIdempotently = () => upload(tokens.employee, project.id, validPdf, {
        workOrderId,
        name: '付款凭证.pdf',
        requestId: `integration-file-upload-${suffix}`,
        idempotencyKey: uploadIdempotencyKey
      });
      const [uploadedResponse, replayedUpload] = await Promise.all([
        uploadIdempotently(),
        uploadIdempotently()
      ]);
      expect(uploadedResponse.status).toBe(201);
      expect(replayedUpload.status).toBe(201);
      expect(replayedUpload.body).toEqual(uploadedResponse.body);
      const fileId = uploadedResponse.body.data.id as string;
      rawFileIds.push(fileId);
      expect(uploadedResponse.body.data).toMatchObject({
        originalFileName: '付款凭证.pdf',
        fileSize: validPdf.length,
        relatedProjectId: project.id,
        relatedWorkOrderId: workOrderId,
        isVoided: false,
        trustStatus: 'untrusted_original',
        downloadPolicy: 'untrusted_original_attachment'
      });
      expect(uploadedResponse.body.data.sha256).toMatch(/^[a-f0-9]{64}$/);
      const storedFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: fileId } });
      storagePaths.push(storedFile.storagePath);
      expect(storedFile.storagePath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
      expect(storedFile.storagePath).not.toContain('付款凭证');
      expect(await prisma.rawFile.count({ where: { id: fileId } })).toBe(1);
      expect(await prisma.workOrderAttachment.count({ where: { workOrderId, rawFileId: fileId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { resourceId: fileId, action: 'file.upload' } })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: fileId, eventType: 'raw_file_uploaded' }
      })).toBe(1);

      await request(app.getHttpServer())
        .get(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${tokens['员工']}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${tokens.reviewer}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(403);

      const preview = await request(app.getHttpServer())
        .get(`/api/files/${fileId}/preview`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('X-Request-Id', `integration-file-preview-${suffix}`)
        .expect('Content-Type', /application\/octet-stream/)
        .expect('Content-Disposition', /attachment/)
        .expect('X-File-Trust', 'untrusted_original')
        .expect(200);
      expect(Buffer.isBuffer(preview.body)).toBe(true);
      expect(preview.body.equals(validPdf)).toBe(true);
      const download = await request(app.getHttpServer())
        .get(`/api/files/${fileId}/download`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-file-download-${suffix}`)
        .expect('Content-Type', /application\/octet-stream/)
        .expect('Content-Disposition', /attachment/)
        .expect('X-File-Trust', 'untrusted_original')
        .expect('X-Download-Options', 'noopen')
        .expect(200);
      expect(download.body.equals(validPdf)).toBe(true);

      await prisma.rawFile.update({ where: { id: fileId }, data: { scanStatus: FileScanStatus.pending } });
      await request(app.getHttpServer())
        .get(`/api/files/${fileId}/download`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(423);
      await prisma.rawFile.update({ where: { id: fileId }, data: { scanStatus: FileScanStatus.failed } });
      await request(app.getHttpServer())
        .get(`/api/files/${fileId}/download`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(409);
      await prisma.rawFile.update({ where: { id: fileId }, data: { scanStatus: FileScanStatus.infected } });
      await request(app.getHttpServer())
        .get(`/api/files/${fileId}/preview`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(403);
      await prisma.rawFile.update({ where: { id: fileId }, data: { scanStatus: FileScanStatus.clean } });

      const removableResponse = await upload(tokens.employee, project.id, validPdf, {
        workOrderId,
        name: 'removable.pdf',
        requestId: `integration-file-removable-${suffix}`
      }).expect(201);
      const removableId = removableResponse.body.data.id as string;
      rawFileIds.push(removableId);
      const removableStored = await prisma.rawFile.findUniqueOrThrow({ where: { id: removableId } });
      storagePaths.push(removableStored.storagePath);
      await request(app.getHttpServer())
        .delete(`/api/files/${removableId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('X-Request-Id', `integration-file-delete-${suffix}`)
        .send({ reason: '重复凭证' })
        .expect(200)
        .expect(({ body }) => expect(body.data).toMatchObject({ status: 'voided', isVoided: true }));
      await request(app.getHttpServer())
        .get(`/api/files/${removableId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(404);
      expect(await prisma.workOrderAttachment.count({ where: { rawFileId: removableId } })).toBe(0);
      await expect(fileStorage.read(removableStored.storagePath)).rejects.toMatchObject({ code: 'ENOENT' });

      await request(app.getHttpServer())
        .patch(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .send({ amount: '120.00', description: '文件集成测试工单', occurredDate: '2026-07-19' })
        .expect(200);
      const [concurrentUpload, concurrentDelete, concurrentSubmit] = await Promise.all([
        upload(tokens.employee, project.id, validPdf, {
          workOrderId,
          name: 'concurrent.pdf',
          requestId: `integration-file-concurrent-upload-${suffix}`
        }),
        request(app.getHttpServer())
          .delete(`/api/files/${fileId}`)
          .set('Authorization', `Bearer ${tokens.employee}`)
          .send({ reason: '与提交并发删除' }),
        request(app.getHttpServer())
          .post(`/api/work-orders/${workOrderId}/submit`)
          .set('Authorization', `Bearer ${tokens.employee}`)
      ]);
      expect(concurrentSubmit.status).toBe(201);
      expect([201, 409]).toContain(concurrentUpload.status);
      expect([200, 409]).toContain(concurrentDelete.status);
      if (concurrentUpload.status === 201) {
        const concurrentFileId = concurrentUpload.body.data.id as string;
        rawFileIds.push(concurrentFileId);
        const concurrentFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: concurrentFileId } });
        storagePaths.push(concurrentFile.storagePath);
      }
      const submittedWorkOrder = await prisma.workOrder.findUniqueOrThrow({
        where: { id: workOrderId },
        include: { attachments: { include: { rawFile: true } } }
      });
      const snapshotAttachments = (submittedWorkOrder.submissionSnapshot as {
        attachments: Array<{ rawFileId: string; sha256: string }>;
      }).attachments;
      expect(snapshotAttachments.map((item) => item.rawFileId).sort())
        .toEqual(submittedWorkOrder.attachments.map((item) => item.rawFileId).sort());
      expect(snapshotAttachments.map((item) => item.sha256).sort())
        .toEqual(submittedWorkOrder.attachments.map((item) => item.rawFile.sha256).sort());
      await upload(tokens.employee, project.id, validPdf, { workOrderId, name: 'late.pdf' }).expect(409);

      const recordFileResponse = await upload(tokens.finance, project.id, validPdf, {
        name: 'record-voucher.pdf',
        requestId: `integration-record-file-upload-${suffix}`
      }).expect(201);
      const recordFileId = recordFileResponse.body.data.id as string;
      rawFileIds.push(recordFileId);
      const recordStoredFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: recordFileId } });
      storagePaths.push(recordStoredFile.storagePath);
      const recordResponse = await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          projectId: project.id,
          templateId: template.id,
          recordType: DataRecordType.reimbursement,
          recordDate: '2026-07-19',
          amount: '120.00',
          sourceType: RecordSourceType.manual,
          sourceId: 'manual',
          status: BusinessRecordStatus.pending_confirm,
          values: [
            { fieldId: recordAmountField.id, value: '120.00' },
            { fieldId: recordDateField.id, value: '2026-07-19' }
          ],
          attachments: [recordFileId]
        })
        .expect(201);
      const recordId = recordResponse.body.data.id as string;
      recordIds.push(recordId);
      expect(recordResponse.body.data.attachments).toEqual([recordFileId]);

      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          projectId: secondProject.id,
          templateId: template.id,
          recordType: DataRecordType.reimbursement,
          recordDate: '2026-07-19',
          amount: '1.00',
          values: [
            { fieldId: recordAmountField.id, value: '1.00' },
            { fieldId: recordDateField.id, value: '2026-07-19' }
          ],
          attachments: [recordFileId]
        })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          projectId: project.id,
          templateId: template.id,
          recordType: DataRecordType.reimbursement,
          recordDate: '2026-07-19',
          amount: '1.00',
          values: [
            { fieldId: recordAmountField.id, value: '1.00' },
            { fieldId: recordDateField.id, value: '2026-07-19' }
          ],
          attachments: [fileId]
        })
        .expect(400);
      await request(app.getHttpServer())
        .delete(`/api/files/${recordFileId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ reason: '尝试删除原始凭证' })
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/api/records/${recordId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/files/${recordFileId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ reason: '记录作废后仍尝试删除' })
        .expect(409);

      const fileAudits = await prisma.auditLog.findMany({ where: { resourceId: { in: rawFileIds } } });
      expect(fileAudits.map((audit) => [audit.action, audit.requestId])).toEqual(expect.arrayContaining([
        ['file.upload', `integration-file-upload-${suffix}`],
        ['file.preview', `integration-file-preview-${suffix}`],
        ['file.download', `integration-file-download-${suffix}`],
        ['file.delete', `integration-file-delete-${suffix}`]
      ]));
      expect(await prisma.ledgerEvent.count({
        where: { aggregateType: 'raw_file', aggregateId: removableId, eventType: 'raw_file_voided' }
      })).toBe(1);
    } finally {
      const persistedStoragePaths = rawFileIds.length
        ? (await prisma.rawFile.findMany({
            where: { id: { in: rawFileIds } },
            select: { storagePath: true }
          })).map((file) => file.storagePath)
        : [];
      if (workOrderIds.length) await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
      if (recordIds.length) await prisma.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      if (projectId || secondProjectId) {
        await prisma.project.deleteMany({ where: { id: { in: [projectId, secondProjectId].filter((id): id is string => Boolean(id)) } } });
      }
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { contains: suffix } } });
      const resourceIds = [...rawFileIds, ...workOrderIds, ...recordIds].filter(Boolean);
      if (resourceIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      }
      for (const storagePath of new Set([...storagePaths, ...persistedStoragePaths])) {
        await fileStorage.remove(storagePath);
      }
    }
  });

  it('serializes cross-user and cross-project uploads at the global S3 logical quota', async () => {
    const capacity = app.get(StorageCapacityService) as any;
    const originalDriver = capacity.driver;
    const originalLogicalQuota = capacity.logicalQuotaBytes;
    const suffix = Date.now().toString(36);
    const projectIds: string[] = [];
    const pathsBefore = new Set(await fileStorage.listPaths());
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const contents = Buffer.from(await pdf.save());

    try {
      const [englishLogin, chineseLogin] = await Promise.all([
        request(app.getHttpServer()).post('/api/auth/login').send({ username: 'finance', password: '123456' }),
        request(app.getHttpServer()).post('/api/auth/login').send({ username: '财务', password: '123456' })
      ]);
      expect(englishLogin.status).toBe(200);
      expect(chineseLogin.status).toBe(200);
      const projects = await Promise.all(['a', 'b'].map((part) => prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}storage_quota_${suffix}_${part}`,
          customerName: 'Capacity test',
          ownerName: 'Capacity test',
          createdBy: 'finance'
        }
      })));
      projectIds.push(...projects.map((project) => project.id));
      const usage = await prisma.rawFile.aggregate({
        where: { isVoided: false },
        _sum: { fileSize: true }
      });
      capacity.driver = 's3';
      capacity.logicalQuotaBytes =
        (usage._sum.fileSize ?? 0n) + capacity.minimumReserveBytes + BigInt(contents.length);

      const upload = (token: string, projectId: string, name: string) => request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('relatedProjectId', projectId)
        .attach('file', contents, { filename: name, contentType: 'application/pdf' });
      const responses = await Promise.all([
        upload(englishLogin.body.data.accessToken, projects[0].id, 'quota-a.pdf'),
        upload(chineseLogin.body.data.accessToken, projects[1].id, 'quota-b.pdf')
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 507]);
      const rejected = responses.find((response) => response.status === 507)!;
      expect(rejected.body).toMatchObject({
        code: 50701,
        data: { reason: 'capacity_reserve_breached' }
      });
      const persisted = await prisma.rawFile.findMany({
        where: { relatedProjectId: { in: projectIds }, isVoided: false }
      });
      expect(persisted).toHaveLength(1);
      const pathsAfter = (await fileStorage.listPaths()).filter((path) => !pathsBefore.has(path));
      expect(pathsAfter).toEqual([persisted[0].storagePath]);
    } finally {
      capacity.driver = originalDriver;
      capacity.logicalQuotaBytes = originalLogicalQuota;
      const stored = projectIds.length
        ? await prisma.rawFile.findMany({
            where: { relatedProjectId: { in: projectIds } },
            select: { id: true, storagePath: true }
          })
        : [];
      const storedIds = stored.map((file) => file.id);
      if (storedIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: storedIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: storedIds } } });
        await prisma.rawFile.deleteMany({ where: { id: { in: storedIds } } });
      }
      if (projectIds.length) await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      const newPaths = (await fileStorage.listPaths()).filter((path) => !pathsBefore.has(path));
      for (const storagePath of new Set([...stored.map((file) => file.storagePath), ...newPaths])) {
        await fileStorage.remove(storagePath);
      }
    }
  });

  it('enforces the configured upload limit at the exact multipart boundary', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const suffix = Date.now().toString(36);
    const rawFileIds: string[] = [];
    const storagePaths: string[] = [];
    let projectId: string | undefined;
    const configuredMb = app.get(ConfigService).get<number>('maxFileSizeMb') ?? 5;
    const limitBytes = configuredMb * 1024 * 1024;
    const quarantineRoot = resolve(
      process.cwd(),
      app.get(ConfigService).get<string>('uploadQuarantineDir') ?? '.upload-quarantine'
    );
    const quarantineEntries = async () => {
      try {
        return (await readdir(quarantineRoot)).sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    };
    const upload = (contents: Buffer, name: string) => request(app.getHttpServer())
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('relatedProjectId', projectId!)
      .attach('file', contents, { filename: name, contentType: 'text/csv' });

    try {
      expect(configuredMb).toBeGreaterThanOrEqual(1);
      expect(configuredMb).toBeLessThanOrEqual(50);
      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}upload_boundary_${suffix}`,
          customerName: 'Boundary customer',
          ownerName: 'Boundary owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;

      for (const [size, name] of [
        [limitBytes - 1, 'below-limit.csv'],
        [limitBytes, 'at-limit.csv']
      ] as const) {
        const contents = Buffer.alloc(size, 0x61);
        for (let index = 4095; index < contents.length; index += 4096) contents[index] = 0x0a;
        const response = await upload(contents, name).expect(201);
        rawFileIds.push(response.body.data.id as string);
        expect(response.body.data.fileSize).toBe(size);
        const stored = await prisma.rawFile.findUniqueOrThrow({ where: { id: response.body.data.id } });
        storagePaths.push(stored.storagePath);
      }

      const persistedBefore = await prisma.rawFile.count({ where: { relatedProjectId: projectId } });
      const quarantineBefore = await quarantineEntries();
      const rejected = await upload(Buffer.alloc(limitBytes + 1, 0x61), 'over-limit.csv').expect(413);
      expect(rejected.body).toEqual({
        code: 41301,
        message: '文件大小超过上传限制',
        data: {}
      });
      expect(await prisma.rawFile.count({ where: { relatedProjectId: projectId } })).toBe(persistedBefore);
      expect(await quarantineEntries()).toEqual(quarantineBefore);
      expect(await prisma.auditLog.count({
        where: { resourceId: { in: rawFileIds }, action: 'file.upload' }
      })).toBe(2);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: { in: rawFileIds }, eventType: 'raw_file_uploaded' }
      })).toBe(2);
    } finally {
      if (rawFileIds.length) {
        await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: rawFileIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: rawFileIds } } });
      }
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      for (const storagePath of storagePaths) await fileStorage.remove(storagePath);
    }
  });

  it('keeps 1, 3, and 5 concurrent uploads and imports complete and unique', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const enabled = await prisma.projectTemplate.findFirstOrThrow({
      where: { isActive: true, project: { status: ProjectStatus.active } },
      include: { project: true, template: true }
    });
    const suffix = Date.now().toString(36);
    const rawFileIds: string[] = [];
    const taskIds: string[] = [];
    const storagePaths: string[] = [];
    const expectedPerKind = 1 + 3 + 5;

    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const pdfBuffer = Buffer.from(await pdf.save());
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Concurrent import').addRows([
      ['日期', '金额'],
      ['2026-07-15', 100]
    ]);
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    try {
      for (const concurrency of [1, 3, 5]) {
        const uploads = await Promise.all(Array.from({ length: concurrency }, (_, index) => request(app.getHttpServer())
          .post('/api/files/upload')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Request-Id', `integration-concurrency-upload-${suffix}-${concurrency}-${index}`)
          .field('relatedProjectId', enabled.projectId)
          .attach('file', pdfBuffer, {
            filename: `concurrent-${concurrency}-${index}.pdf`,
            contentType: 'application/pdf'
          })));
        expect(uploads.map((response) => response.status)).toEqual(Array(concurrency).fill(201));
        rawFileIds.push(...uploads.map((response) => response.body.data.id as string));

        const imports = await Promise.all(Array.from({ length: concurrency }, (_, index) => request(app.getHttpServer())
          .post('/api/import-tasks')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', `integration-concurrency-import-${suffix}-${concurrency}-${index}`)
          .set('X-Request-Id', `integration-concurrency-import-${suffix}-${concurrency}-${index}`)
          .field('projectId', enabled.projectId)
          .field('templateId', enabled.templateId)
          .field('importType', enabled.template.recordType)
          .attach('file', xlsxBuffer, {
            filename: `concurrent-import-${concurrency}-${index}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          })));
        expect(imports.map((response) => response.status)).toEqual(Array(concurrency).fill(201));
        const batchTaskIds = imports.map((response) => response.body.data.id as string);
        const batchRawFileIds = imports.map((response) => response.body.data.rawFileId as string);
        taskIds.push(...batchTaskIds);
        rawFileIds.push(...batchRawFileIds);

        const parses = await Promise.all(batchTaskIds.map((taskId) => request(app.getHttpServer())
          .post(`/api/import-tasks/${taskId}/parse`)
          .set('Authorization', `Bearer ${token}`)
          .send({})));
        expect(parses.map((response) => response.status)).toEqual(Array(concurrency).fill(201));
        for (const parsed of parses) {
          expect([ImportTaskStatus.mapping, ImportTaskStatus.pending_confirm]).toContain(parsed.body.data.status);
        }
      }

      expect(new Set(rawFileIds).size).toBe(expectedPerKind * 2);
      expect(new Set(taskIds).size).toBe(expectedPerKind);
      expect(await prisma.rawFile.count({ where: { id: { in: rawFileIds } } })).toBe(expectedPerKind * 2);
      expect(await prisma.importTask.count({ where: { id: { in: taskIds } } })).toBe(expectedPerKind);
      expect(await prisma.businessRecord.count({ where: { importTaskId: { in: taskIds } } })).toBe(0);
      expect(await prisma.auditLog.count({
        where: { resourceId: { in: rawFileIds }, action: 'file.upload' }
      })).toBe(expectedPerKind * 2);
      expect(await prisma.auditLog.count({
        where: { resourceId: { in: taskIds }, action: 'import_task.parse' }
      })).toBe(expectedPerKind);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: { in: rawFileIds }, eventType: 'raw_file_uploaded' }
      })).toBe(expectedPerKind * 2);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: { in: taskIds }, eventType: 'import_task_parsed' }
      })).toBe(expectedPerKind);
    } finally {
      if (rawFileIds.length) {
        storagePaths.push(...(await prisma.rawFile.findMany({
          where: { id: { in: rawFileIds } },
          select: { storagePath: true }
        })).map((file) => file.storagePath));
      }
      if (taskIds.length) await prisma.importTask.deleteMany({ where: { id: { in: taskIds } } });
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      const resourceIds = [...taskIds, ...rawFileIds];
      if (resourceIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      }
      for (const storagePath of storagePaths) await fileStorage.remove(storagePath);
    }
  });

  it('aggregates only confirmed records with China-time boundaries and shared AI report tools', async () => {
    const usernames = ['finance', 'boss', 'employee', 'reviewer'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof usernames)[number], string>;
    const suffix = Date.now().toString(36);
    const projectId = `${TEST_USER_PREFIX}report_${suffix}`;
    const recordIds = Array.from({ length: 9 }, (_, index) => `${projectId}_record_${index + 1}`);
    const dailyRange = dayRange(undefined);
    const reportDate = dailyRange.startDate;
    const reportMonth = reportDate.slice(0, 7);
    const boundaryDates = {
      insideStart: new Date(dailyRange.start),
      insideEnd: new Date(dailyRange.end.getTime() - 1),
      outsideBefore: new Date(dailyRange.start.getTime() - 1),
      outsideAfter: new Date(dailyRange.end)
    };
    const confirmedBoundaryRecords = [
      { date: boundaryDates.insideStart, income: 100.1, expense: 0 },
      { date: boundaryDates.insideEnd, income: 0, expense: 40.05 },
      { date: boundaryDates.outsideBefore, income: 9999, expense: 0 },
      { date: boundaryDates.outsideAfter, income: 0, expense: 9999 }
    ];
    const monthlyRange = monthRange(reportMonth);
    const monthlyRecords = confirmedBoundaryRecords.filter(
      (record) => record.date >= monthlyRange.start && record.date < monthlyRange.end
    );
    const expectedMonthlyIncome = monthlyRecords.reduce((sum, record) => sum + record.income, 0);
    const expectedMonthlyExpense = monthlyRecords.reduce((sum, record) => sum + record.expense, 0);
    const expectedMonthlyDates = Array.from(new Set(monthlyRecords.map((record) => formatChinaDate(record.date)))).sort();
    let conversationId: string | undefined;

    try {
      await prisma.project.create({
        data: {
          id: projectId,
          name: `${TEST_USER_PREFIX}report project ${suffix}`,
          customerName: '报表边界客户',
          ownerName: '报表测试'
        }
      });
      const base = {
        projectId,
        description: 'C10 report boundary record',
        sourceType: RecordSourceType.manual,
        attachments: [],
        createdBy: 'integration'
      };
      await prisma.businessRecord.createMany({
        data: [
          {
            ...base,
            id: recordIds[0],
            templateId: 'dt-revenue',
            recordType: DataRecordType.revenue,
            recordDate: boundaryDates.insideStart,
            amount: new Prisma.Decimal('100.10'),
            accountingDirection: AccountingDirection.income,
            category: '收入',
            subCategory: '边界收入',
            sourceId: `${projectId}-inside-start`,
            status: BusinessRecordStatus.confirmed,
            confirmedAt: new Date(),
            confirmedBy: 'integration'
          },
          {
            ...base,
            id: recordIds[1],
            templateId: 'dt-reimbursement',
            recordType: DataRecordType.reimbursement,
            recordDate: boundaryDates.insideEnd,
            amount: new Prisma.Decimal('40.05'),
            accountingDirection: AccountingDirection.expense,
            category: '支出',
            subCategory: '边界成本',
            sourceId: `${projectId}-inside-end`,
            status: BusinessRecordStatus.confirmed,
            confirmedAt: new Date(),
            confirmedBy: 'integration'
          },
          {
            ...base,
            id: recordIds[2],
            templateId: 'dt-revenue',
            recordType: DataRecordType.revenue,
            recordDate: boundaryDates.outsideBefore,
            amount: new Prisma.Decimal('9999.00'),
            accountingDirection: AccountingDirection.income,
            category: '收入',
            subCategory: '前一日收入',
            sourceId: `${projectId}-outside-before`,
            status: BusinessRecordStatus.confirmed,
            confirmedAt: new Date(),
            confirmedBy: 'integration'
          },
          {
            ...base,
            id: recordIds[3],
            templateId: 'dt-reimbursement',
            recordType: DataRecordType.reimbursement,
            recordDate: boundaryDates.outsideAfter,
            amount: new Prisma.Decimal('9999.00'),
            accountingDirection: AccountingDirection.expense,
            category: '支出',
            subCategory: '后一日成本',
            sourceId: `${projectId}-outside-after`,
            status: BusinessRecordStatus.confirmed,
            confirmedAt: new Date(),
            confirmedBy: 'integration'
          },
          {
            ...base,
            id: recordIds[4],
            templateId: 'dt-revenue',
            recordType: DataRecordType.revenue,
            recordDate: new Date(dailyRange.start.getTime() + 12 * 60 * 60 * 1000),
            amount: new Prisma.Decimal('5000.00'),
            accountingDirection: AccountingDirection.income,
            category: '收入',
            subCategory: '草稿收入',
            sourceId: `${projectId}-draft`,
            status: BusinessRecordStatus.draft
          },
          {
            ...base,
            id: recordIds[5],
            templateId: 'dt-reimbursement',
            recordType: DataRecordType.reimbursement,
            recordDate: new Date(dailyRange.start.getTime() + 13 * 60 * 60 * 1000),
            amount: new Prisma.Decimal('5000.00'),
            accountingDirection: AccountingDirection.expense,
            category: '支出',
            subCategory: '待确认成本',
            sourceId: `${projectId}-pending`,
            status: BusinessRecordStatus.pending_confirm
          },
          {
            ...base,
            id: recordIds[6],
            templateId: 'dt-reimbursement',
            recordType: DataRecordType.reimbursement,
            recordDate: new Date(dailyRange.start.getTime() + 14 * 60 * 60 * 1000),
            amount: new Prisma.Decimal('5000.00'),
            accountingDirection: AccountingDirection.expense,
            category: '支出',
            subCategory: '作废成本',
            sourceId: `${projectId}-voided`,
            status: BusinessRecordStatus.rejected,
            voidedAt: new Date(),
            voidedBy: 'integration'
          },
          {
            ...base,
            id: recordIds[7],
            templateId: 'dt-revenue',
            recordType: DataRecordType.revenue,
            recordDate: new Date(dailyRange.start.getTime() + 15 * 60 * 60 * 1000),
            amount: new Prisma.Decimal('88888.88'),
            accountingDirection: AccountingDirection.income,
            dataLayer: RecordDataLayer.reconciliation,
            category: '收入',
            subCategory: '对账汇总',
            sourceId: `${projectId}-reconciliation`,
            status: BusinessRecordStatus.confirmed,
            confirmedAt: new Date(),
            confirmedBy: 'integration'
          },
          {
            ...base,
            id: recordIds[8],
            templateId: 'dt-reimbursement',
            recordType: DataRecordType.reimbursement,
            recordDate: new Date(dailyRange.start.getTime() + 16 * 60 * 60 * 1000),
            amount: new Prisma.Decimal('77777.77'),
            accountingDirection: AccountingDirection.expense,
            dataLayer: RecordDataLayer.budget,
            category: '支出',
            subCategory: '预算',
            sourceId: `${projectId}-budget`,
            status: BusinessRecordStatus.confirmed,
            confirmedAt: new Date(),
            confirmedBy: 'integration'
          }
        ]
      });

      await request(app.getHttpServer()).get('/api/reports/finance').expect(401);
      for (const role of ['employee', 'reviewer'] as const) {
        await request(app.getHttpServer())
          .get(`/api/reports/finance?period=today&date=${reportDate}`)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
        await request(app.getHttpServer())
          .get(`/api/reports/boss?period=daily&date=${reportDate}`)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
        await request(app.getHttpServer())
          .get(`/api/reports/projects/${projectId}/daily?date=${reportDate}`)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
      }
      await request(app.getHttpServer())
        .get(`/api/reports/boss?period=daily&date=${reportDate}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/reports/finance?period=quarter&date=${reportDate}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);
      await request(app.getHttpServer())
        .get(`/api/reports/projects/${projectId}/daily?date=2026-02-30`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);

      const projectDaily = await request(app.getHttpServer())
        .get(`/api/reports/projects/${projectId}/daily?date=${reportDate}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(projectDaily.body.data).toMatchObject({
        projectId,
        date: reportDate,
        range: { startDate: reportDate, endDate: reportDate, timezone: 'Asia/Shanghai' },
        income: '100.10',
        expense: '40.05',
        cost: '40.05',
        profit: '60.05',
        recordCount: 2,
        anomalyCount: 0
      });
      expect(projectDaily.body.data.expenseCategories).toEqual([
        { name: '边界成本', amount: '40.05', recordCount: 1, percentage: 1 }
      ]);
      const projectSummary = await request(app.getHttpServer())
        .get(`/api/projects/${projectId}/summary`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(projectSummary.body.data).toMatchObject({
        recordCount: 9,
        totalIncome: '10099.10',
        totalCost: '10039.05',
        profit: '60.05'
      });

      const projectMonthly = await request(app.getHttpServer())
        .get(`/api/reports/projects/${projectId}/monthly?month=${reportMonth}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(projectMonthly.body.data).toMatchObject({
        projectId,
        month: reportMonth,
        income: expectedMonthlyIncome.toFixed(2),
        expense: expectedMonthlyExpense.toFixed(2),
        profit: (expectedMonthlyIncome - expectedMonthlyExpense).toFixed(2),
        recordCount: monthlyRecords.length
      });
      expect(projectMonthly.body.data.dailyTrend.map((item: { date: string }) => item.date)).toEqual(expectedMonthlyDates);

      const financeReport = await request(app.getHttpServer())
        .get(`/api/reports/finance?period=today&date=${reportDate}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(financeReport.body.data).toMatchObject({
        period: 'today',
        range: { startDate: reportDate, endDate: reportDate, timezone: 'Asia/Shanghai' }
      });
      expect(financeReport.body.data.expenseCategories).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '边界成本', amount: '40.05', recordCount: 1 })
      ]));

      const bossReport = await request(app.getHttpServer())
        .get(`/api/reports/boss?period=daily&date=${reportDate}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(bossReport.body.data).toMatchObject({
        period: 'daily',
        income: financeReport.body.data.totalIncome,
        expense: financeReport.body.data.totalExpense,
        profit: financeReport.body.data.estimatedProfit
      });
      expect(bossReport.body.data.projectRanking).toEqual(expect.arrayContaining([
        expect.objectContaining({ projectId, income: '100.10', cost: '40.05', profit: '60.05' })
      ]));

      const chat = await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .set('X-Request-Id', `integration-report-ai-${suffix}`)
        .send({ message: '今天经营情况' })
        .expect(201);
      conversationId = chat.body.data.conversationId as string;
      expect(chat.body.data.toolsUsed).toContain('get_today_report');
      const assistant = await prisma.aiMessage.findFirstOrThrow({
        where: { conversationId, role: AiMessageRole.assistant },
        orderBy: { createdAt: 'desc' }
      });
      const context = assistant.toolContext as Array<{ name: string; data: Record<string, unknown> }>;
      const todayTool = context.find((item) => item.name === 'get_today_report');
      expect(todayTool?.data).toMatchObject({
        income: bossReport.body.data.income,
        expense: bossReport.body.data.expense,
        profit: bossReport.body.data.profit
      });
    } finally {
      if (conversationId) {
        await prisma.aiCallLog.deleteMany({ where: { conversationId } });
        await prisma.auditLog.deleteMany({ where: { resourceId: conversationId } });
        await prisma.aiConversation.deleteMany({ where: { id: conversationId } });
      }
      await prisma.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
  });

  it('isolates notification visibility and read receipts per token user', async () => {
    const usernames = ['finance', '财务', 'employee', 'reviewer'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof usernames)[number], string>;
    const users = Object.fromEntries(await Promise.all(usernames.map(async (username) => [
      username,
      await prisma.user.findUniqueOrThrow({ where: { username } })
    ] as const)));
    const suffix = Date.now().toString(36);
    const requestPrefix = `integration-notification-${suffix}`;
    const notificationIds: string[] = [];

    try {
      const created = await prisma.$transaction([
        prisma.notification.create({
          data: {
            title: `C9 role ${suffix}`,
            content: 'finance role broadcast',
            type: 'audit',
            senderName: 'integration',
            targetRole: UserRole.finance
          }
        }),
        prisma.notification.create({
          data: {
            title: `C9 private finance ${suffix}`,
            content: 'english finance only',
            type: 'system',
            senderName: 'integration',
            targetRole: UserRole.finance,
            targetUserId: users.finance.id
          }
        }),
        prisma.notification.create({
          data: {
            title: `C9 private chinese finance ${suffix}`,
            content: 'chinese finance only',
            type: 'system',
            senderName: 'integration',
            targetRole: UserRole.finance,
            targetUserId: users['财务'].id
          }
        }),
        prisma.notification.create({
          data: {
            title: `C9 reviewer ${suffix}`,
            content: 'reviewer role only',
            type: 'audit',
            senderName: 'integration',
            targetRole: UserRole.reviewer
          }
        }),
        prisma.notification.create({
          data: {
            title: `C9 employee ${suffix}`,
            content: 'employee private only',
            type: 'system',
            senderName: 'integration',
            targetRole: UserRole.employee,
            targetUserId: users.employee.id
          }
        })
      ]);
      notificationIds.push(...created.map((item) => item.id));
      const [roleNotice, privateFinance, privateChineseFinance, reviewerNotice, employeeNotice] = created;

      await request(app.getHttpServer()).get('/api/notifications').expect(401);
      await request(app.getHttpServer())
        .get('/api/notifications?read=invalid')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/notifications?page=0')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);

      const financePage = await request(app.getHttpServer())
        .get('/api/notifications?page=1&pageSize=1&targetRole=reviewer')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(financePage.body.data).toMatchObject({ page: 1, pageSize: 1, total: 2, unreadCount: 2 });
      expect(financePage.body.data.items).toHaveLength(1);
      const financeAll = await request(app.getHttpServer())
        .get('/api/notifications?page=1&pageSize=20')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(financeAll.body.data.items.map((item: { id: string }) => item.id).sort()).toEqual(
        [roleNotice.id, privateFinance.id].sort()
      );

      const chineseFinance = await request(app.getHttpServer())
        .get('/api/notifications?page=1&pageSize=20')
        .set('Authorization', `Bearer ${tokens['财务']}`)
        .expect(200);
      expect(chineseFinance.body.data.items.map((item: { id: string }) => item.id).sort()).toEqual(
        [roleNotice.id, privateChineseFinance.id].sort()
      );
      const reviewerList = await request(app.getHttpServer())
        .get('/api/notifications?page=1&pageSize=20')
        .set('Authorization', `Bearer ${tokens.reviewer}`)
        .expect(200);
      expect(reviewerList.body.data.items.map((item: { id: string }) => item.id)).toEqual([reviewerNotice.id]);
      const employeeList = await request(app.getHttpServer())
        .get('/api/notifications?page=1&pageSize=20')
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(200);
      expect(employeeList.body.data.items.map((item: { id: string }) => item.id)).toEqual([employeeNotice.id]);

      await request(app.getHttpServer())
        .patch(`/api/notifications/${privateChineseFinance.id}/read`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/notifications/${roleNotice.id}/read`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `${requestPrefix}-read`)
        .expect(200)
        .expect(({ body }) => expect(body.data).toMatchObject({ id: roleNotice.id, read: true }));
      await request(app.getHttpServer())
        .patch(`/api/notifications/${roleNotice.id}/read`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `${requestPrefix}-read-duplicate`)
        .expect(200);

      const financeRead = await request(app.getHttpServer())
        .get('/api/notifications?read=true&page=1&pageSize=20')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(financeRead.body.data.items.map((item: { id: string }) => item.id)).toEqual([roleNotice.id]);
      expect(financeRead.body.data.unreadCount).toBe(1);
      const financeUnread = await request(app.getHttpServer())
        .get('/api/notifications?read=false&page=1&pageSize=20')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(financeUnread.body.data.items.map((item: { id: string }) => item.id)).toEqual([privateFinance.id]);

      const chineseAfterEnglishRead = await request(app.getHttpServer())
        .get('/api/notifications?page=1&pageSize=20')
        .set('Authorization', `Bearer ${tokens['财务']}`)
        .expect(200);
      expect(chineseAfterEnglishRead.body.data.unreadCount).toBe(2);
      expect(chineseAfterEnglishRead.body.data.items.find((item: { id: string }) => item.id === roleNotice.id).read).toBe(false);

      await request(app.getHttpServer())
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `${requestPrefix}-read-all`)
        .expect(200)
        .expect(({ body }) => expect(body.data).toEqual({ updatedCount: 1, unreadCount: 0 }));
      await request(app.getHttpServer())
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `${requestPrefix}-read-all-duplicate`)
        .expect(200)
        .expect(({ body }) => expect(body.data).toEqual({ updatedCount: 0, unreadCount: 0 }));

      expect(await prisma.notificationReceipt.count({
        where: { userId: users.finance.id, notificationId: { in: [roleNotice.id, privateFinance.id] } }
      })).toBe(2);
      expect(await prisma.notificationReceipt.count({
        where: { userId: users['财务'].id, notificationId: roleNotice.id }
      })).toBe(0);
      const audits = await prisma.auditLog.findMany({ where: { requestId: { startsWith: requestPrefix } } });
      expect(audits.map((audit) => [audit.action, audit.requestId])).toEqual(expect.arrayContaining([
        ['notification.read', `${requestPrefix}-read`],
        ['notification.read_all', `${requestPrefix}-read-all`]
      ]));
      expect(audits.filter((audit) => audit.action === 'notification.read')).toHaveLength(1);
      expect(audits.filter((audit) => audit.action === 'notification.read_all')).toHaveLength(1);
    } finally {
      if (notificationIds.length) await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
      await prisma.auditLog.deleteMany({ where: { requestId: { startsWith: requestPrefix } } });
    }
  });

  it('persists boss AI conversations through approved tools with ownership and call-log boundaries', async () => {
    const usernames = ['boss', '老板', 'finance', 'employee', 'reviewer', 'auditor'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof usernames)[number], string>;
    const bossUser = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } });
    const suffix = Date.now().toString(36);
    const requestPrefix = `integration-ai-${suffix}`;
    const callLogIds: string[] = [];
    let conversationId: string | undefined;
    let otherConversationId: string | undefined;
    let otherCallLogId: string | undefined;
    let expiredCallLogId: string | undefined;

    const chat = async (message: string, index: number, extra: Record<string, unknown> = {}) => {
      const response = await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .set('X-Request-Id', `${requestPrefix}-${index}`)
        .send({ message, conversationId, ...extra })
        .expect(201);
      conversationId = response.body.data.conversationId as string;
      callLogIds.push(response.body.data.callLogId as string);
      return response.body.data as {
        conversationId: string;
        reply: string;
        callLogId: string;
        provider: string;
        fallback: boolean;
        toolsUsed: string[];
      };
    };

    try {
      await request(app.getHttpServer()).post('/api/ai/chat').send({ message: '今天经营情况' }).expect(401);
      for (const role of ['finance', 'employee', 'reviewer'] as const) {
        await request(app.getHttpServer())
          .post('/api/ai/chat')
          .set('Authorization', `Bearer ${tokens[role]}`)
          .send({ message: '今天经营情况' })
          .expect(403);
      }
      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ message: '   ' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ message: 'x'.repeat(2001) })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({ message: '今天经营情况', role: UserRole.boss })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .send({
          message: '今天经营情况',
          history: Array.from({ length: 51 }, (_, index) => ({ role: 'user', content: `history-${index}` }))
        })
        .expect(400);

      const today = await chat('今天经营情况怎么样', 1);
      const todayCallLog = await prisma.aiCallLog.findUniqueOrThrow({ where: { id: today.callLogId } });
      expect(todayCallLog.errorMessage).toBeNull();
      expect(today).toMatchObject({ provider: 'mock', fallback: false, toolsUsed: ['get_today_report'] });
      expect(today.reply).toContain('没有已确认实绩经营记录');
      expect(today.reply).not.toMatch(/收入\d+(?:\.\d+)?元.*利润\d+(?:\.\d+)?元/);

      const project = await chat('太和中转项目收入成本利润如何', 2);
      expect(project.toolsUsed).toEqual(['get_project_summary']);
      expect(project.reply).toContain('太和中转项目');

      const pending = await chat('有哪些待老板审批工单', 3);
      expect(pending.toolsUsed).toEqual(['get_pending_approvals']);
      expect(pending.reply).toContain('WO202607110001');

      const anomalies = await chat('今天有哪些异常', 4);
      expect(anomalies.toolsUsed).toEqual(expect.arrayContaining(['get_anomalies', 'get_today_report']));
      expect(anomalies.reply).toContain('异常工单');

      const workOrder = await chat('解释这张工单的风险', 5, { workOrderId: 'wo-seed-boss-pending' });
      expect(workOrder.toolsUsed).toEqual(['get_work_order_detail']);
      expect(workOrder.reply).toContain('WO202607110001');

      const missing = await chat('不存在项目利润多少', 6);
      expect(missing.toolsUsed).toEqual(['get_project_summary']);
      expect(missing.reply).toContain('需要人工确认');
      expect(missing.reply).not.toMatch(/不存在项目.*\d+元/);

      const companyComparison = await chat('2026年7月利润环比如何', 7);
      expect(companyComparison.toolsUsed).toEqual(['get_period_comparison']);
      expect(companyComparison.reply).toContain('月环比');

      const projectComparison = await chat('太和中转项目2026年7月利润同比如何', 8);
      expect(projectComparison.toolsUsed).toEqual(['get_period_comparison']);
      expect(projectComparison.reply).toContain('月同比');

      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens['老板']}`)
        .send({ message: '继续查询', conversationId })
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/ai/conversations')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(403);
      const ownConversations = await request(app.getHttpServer())
        .get('/api/ai/conversations?page=1&pageSize=1')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(ownConversations.body.data).toMatchObject({ page: 1, pageSize: 1 });
      expect(ownConversations.body.data.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: conversationId, messageCount: 16 })
      ]));
      const ownMessages = await request(app.getHttpServer())
        .get(`/api/ai/conversations/${conversationId}/messages?page=1&pageSize=5`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(ownMessages.body.data).toMatchObject({ page: 1, pageSize: 5, total: 16 });
      expect(ownMessages.body.data.items).toHaveLength(5);
      await request(app.getHttpServer())
        .get(`/api/ai/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${tokens['老板']}`)
        .expect(403);
      const otherChat = await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens['老板']}`)
        .set('X-Request-Id', `${requestPrefix}-other-boss`)
        .send({ message: '今天经营情况' })
        .expect(201);
      otherConversationId = otherChat.body.data.conversationId as string;
      otherCallLogId = otherChat.body.data.callLogId as string;
      await prisma.aiCallLog.update({
        where: { id: callLogIds[0] },
        data: {
          requestPayload: { authorization: 'Bearer synthetic-secret-token', phone: '13800000000' },
          responsePayload: { apiKey: 'synthetic-provider-secret', email: 'owner@example.com' },
          endpointSnapshot: 'https://provider-user:provider-password@example.invalid/v1/synthetic-secret-token?api_key=secret#token'
        }
      });
      const expiredCallLog = await prisma.aiCallLog.create({
        data: {
          provider: 'mock',
          modelName: 'expired-audit-fixture',
          requestPayload: {},
          success: true,
          createdBy: bossUser.id,
          createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000)
        }
      });
      expiredCallLogId = expiredCallLog.id;
      await request(app.getHttpServer())
        .get('/api/ai/call-logs')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/ai/call-logs?success=invalid')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(400);
      const callLogPage = await request(app.getHttpServer())
        .get('/api/ai/call-logs?provider=mock&success=true&page=1&pageSize=100')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(callLogPage.body.data.items.map((item: { id: string }) => item.id)).toEqual(
        expect.arrayContaining(callLogIds)
      );
      expect(callLogPage.body.data.items.map((item: { id: string }) => item.id)).not.toContain(otherCallLogId);
      const ordinaryMetadata = callLogPage.body.data.items.find((item: { id: string }) => item.id === callLogIds[0]);
      expect(ordinaryMetadata).toMatchObject({
        model: expect.any(String),
        latencyMs: expect.any(Number),
        status: 'succeeded',
        fallback: false,
        inputHash: expect.any(String)
      });
      expect(ordinaryMetadata).not.toHaveProperty('input');
      expect(ordinaryMetadata).not.toHaveProperty('output');
      expect(ordinaryMetadata).not.toHaveProperty('requestPayload');
      expect(ordinaryMetadata).not.toHaveProperty('responsePayload');
      await request(app.getHttpServer())
        .get(`/api/ai/call-logs/${callLogIds[0]}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/ai/call-logs/${otherCallLogId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(404);
      const otherCallLogPage = await request(app.getHttpServer())
        .get('/api/ai/call-logs?provider=mock&page=1&pageSize=100')
        .set('Authorization', `Bearer ${tokens['老板']}`)
        .expect(200);
      expect(otherCallLogPage.body.data.items.map((item: { id: string }) => item.id)).toContain(otherCallLogId);
      expect(otherCallLogPage.body.data.items.map((item: { id: string }) => item.id)).not.toEqual(
        expect.arrayContaining(callLogIds)
      );
      await request(app.getHttpServer())
        .get('/api/ai/audit/call-logs')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(403);
      const auditorPage = await request(app.getHttpServer())
        .get('/api/ai/audit/call-logs?provider=mock&page=1&pageSize=100')
        .set('Authorization', `Bearer ${tokens.auditor}`)
        .expect(200);
      expect(auditorPage.body.data.items.map((item: { id: string }) => item.id)).toEqual(
        expect.arrayContaining([...callLogIds, otherCallLogId])
      );
      expect(auditorPage.body.data.items.map((item: { id: string }) => item.id)).not.toContain(expiredCallLogId);
      const redacted = auditorPage.body.data.items.find((item: { id: string }) => item.id === callLogIds[0]);
      expect(redacted).toMatchObject({
        ownerUserId: bossUser.id,
        endpointSnapshot: 'https://example.invalid',
        requestPayload: { authorization: '[REDACTED]', phone: '[REDACTED_PHONE]' },
        responsePayload: { apiKey: '[REDACTED]', email: '[REDACTED_EMAIL]' }
      });
      expect(JSON.stringify(redacted)).not.toMatch(/synthetic-secret-token|provider-password|api_key|13800000000|owner@example\.com/);

      const [messages, logs, audits] = await Promise.all([
        prisma.aiMessage.findMany({ where: { conversationId } }),
        prisma.aiCallLog.findMany({ where: { id: { in: callLogIds } } }),
        prisma.auditLog.findMany({ where: { resourceId: conversationId, action: 'ai.chat' } })
      ]);
      expect(messages).toHaveLength(16);
      expect(messages.filter((item) => item.role === AiMessageRole.user)).toHaveLength(8);
      expect(messages.filter((item) => item.role === AiMessageRole.assistant)).toHaveLength(8);
      expect(logs).toHaveLength(8);
      expect(new Set(callLogIds).size).toBe(8);
      expect(logs.every((item) => item.success && item.provider === 'mock' && item.createdBy === bossUser.id)).toBe(true);
      expect(logs.every((item) => /^[a-f0-9]{64}$/.test(item.inputHash ?? ''))).toBe(true);
      const generatedAuditLogs = logs.filter((item) => item.id !== callLogIds[0]);
      expect(generatedAuditLogs).toHaveLength(7);
      expect(generatedAuditLogs.every((item) => (
        item.requestPayload as { schemaVersion?: string }
      ).schemaVersion === 'ai-call-audit/1.0')).toBe(true);
      expect(generatedAuditLogs.every((item) => !Object.prototype.hasOwnProperty.call(item.requestPayload, 'message'))).toBe(true);
      expect(generatedAuditLogs.every((item) => !Object.prototype.hasOwnProperty.call(item.requestPayload, 'contexts'))).toBe(true);
      expect(JSON.stringify(generatedAuditLogs.map((item) => item.requestPayload))).not.toContain('今天经营情况怎么样');
      expect(logs.map((item) => item.correlationId)).toEqual(expect.arrayContaining(
        Array.from({ length: 8 }, (_, index) => `${requestPrefix}-${index + 1}`)
      ));
      expect(logs.every((item) => item.attemptNo === 1 && item.fallback === false)).toBe(true);
      expect(JSON.stringify(
        logs.filter((item) => item.id !== callLogIds[0]).map((item) => item.requestPayload)
      )).not.toMatch(/Bearer|123456|JWT_SECRET/i);
      expect(audits).toHaveLength(8);
      expect(audits.map((item) => item.requestId)).toEqual(expect.arrayContaining(
        Array.from({ length: 8 }, (_, index) => `${requestPrefix}-${index + 1}`)
      ));
    } finally {
      if (callLogIds.length) await prisma.aiCallLog.deleteMany({ where: { id: { in: callLogIds } } });
      if (otherCallLogId) await prisma.aiCallLog.deleteMany({ where: { id: otherCallLogId } });
      if (expiredCallLogId) await prisma.aiCallLog.deleteMany({ where: { id: expiredCallLogId } });
      if (conversationId) {
        await prisma.auditLog.deleteMany({ where: { resourceId: conversationId } });
        await prisma.aiConversation.deleteMany({ where: { id: conversationId } });
      }
      if (otherConversationId) {
        await prisma.auditLog.deleteMany({ where: { resourceId: otherConversationId } });
        await prisma.aiConversation.deleteMany({ where: { id: otherConversationId } });
      }
    }
  });

  it('matches B8-05 PostgreSQL golden reports, rankings, and structured AI claims', async () => {
    const usernames = ['finance', 'boss', 'employee', 'reviewer'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof usernames)[number], string>;
    const suffix = Date.now().toString(36);
    const requestPrefix = `integration-ai-golden-${suffix}`;
    const projectIds: string[] = [];
    const recordIds: string[] = [];
    const conversationIds: string[] = [];
    const projects = [
      {
        caseId: 'golden-project-a',
        name: `${TEST_USER_PREFIX}gold_a_${suffix}`,
        customerName: `${TEST_USER_PREFIX}customer_x_${suffix}`,
        income: '1000.00',
        expense: '250.00',
        profit: '750.00'
      },
      {
        caseId: 'golden-project-b',
        name: `${TEST_USER_PREFIX}gold_b_${suffix}`,
        customerName: `${TEST_USER_PREFIX}customer_x_${suffix}`,
        income: '600.00',
        expense: '100.00',
        profit: '500.00'
      },
      {
        caseId: 'golden-project-c',
        name: `${TEST_USER_PREFIX}gold_c_${suffix}`,
        customerName: `${TEST_USER_PREFIX}customer_y_${suffix}`,
        income: '900.00',
        expense: '700.00',
        profit: '200.00'
      }
    ];

    const assertGolden = (actual: unknown, expected: unknown, caseId: string, path: string) => {
      if (String(actual) !== String(expected)) throw new Error(`[${caseId}] ${path}: mismatch`);
    };
    const chat = async (message: string, caseId: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .set('X-Request-Id', `${requestPrefix}-${caseId}`)
        .send({ message })
        .expect(201);
      conversationIds.push(response.body.data.conversationId as string);
      return response.body.data as {
        fallback: boolean;
        toolsUsed: string[];
        claims: Array<{
          scopeType: string;
          scopeId: string;
          period: string;
          metric: string;
          value: string;
          unit: string;
          sourceTool: string;
          sourcePath: string;
        }>;
      };
    };

    try {
      for (const [projectIndex, project] of projects.entries()) {
        const created = await request(app.getHttpServer())
          .post('/api/projects')
          .set('Authorization', `Bearer ${tokens.finance}`)
          .set('X-Request-Id', `${requestPrefix}-project-${projectIndex}`)
          .send({ name: project.name, customerName: project.customerName, ownerName: 'Golden owner' })
          .expect(201);
        const projectId = created.body.data.id as string;
        projectIds.push(projectId);
        Object.assign(project, { id: projectId });

        for (const [templateIndex, templateId] of ['dt-revenue', 'dt-reimbursement'].entries()) {
          await request(app.getHttpServer())
            .post(`/api/projects/${projectId}/templates`)
            .set('Authorization', `Bearer ${tokens.finance}`)
            .set('X-Request-Id', `${requestPrefix}-template-${projectIndex}-${templateIndex}`)
            .send({ templateId })
            .expect(201);
        }

        const entries = [
          {
            templateId: 'dt-revenue',
            recordType: DataRecordType.revenue,
            amount: project.income,
            values: [
              { fieldId: 'f-date', value: '2038-05-15' },
              { fieldId: 'f-site', value: 'Golden site' },
              { fieldId: 'f-ticket', value: '1' },
              { fieldId: 'f-income', value: project.income }
            ]
          },
          {
            templateId: 'dt-reimbursement',
            recordType: DataRecordType.reimbursement,
            amount: project.expense,
            values: [
              { fieldId: 'f-date', value: '2038-05-15' },
              { fieldId: 'f-reason', value: 'Golden expense' },
              { fieldId: 'f-cost-category', value: 'Golden category' },
              { fieldId: 'f-amount', value: project.expense }
            ]
          }
        ];

        for (const [entryIndex, entry] of entries.entries()) {
          const record = await request(app.getHttpServer())
            .post('/api/records')
            .set('Authorization', `Bearer ${tokens.finance}`)
            .set('X-Request-Id', `${requestPrefix}-record-${projectIndex}-${entryIndex}`)
            .send({
              projectId,
              templateId: entry.templateId,
              recordType: entry.recordType,
              recordDate: '2038-05-15',
              amount: entry.amount,
              sourceType: RecordSourceType.manual,
              sourceId: 'manual',
              status: BusinessRecordStatus.pending_confirm,
              values: entry.values,
              attachments: []
            })
            .expect(201);
          const recordId = record.body.data.id as string;
          recordIds.push(recordId);
          await request(app.getHttpServer())
            .post(`/api/records/${recordId}/confirm`)
            .set('Authorization', `Bearer ${tokens.finance}`)
            .set('X-Request-Id', `${requestPrefix}-confirm-${projectIndex}-${entryIndex}`)
            .expect(201);
        }
      }

      for (const project of projects as Array<(typeof projects)[number] & { id: string }>) {
        const report = await request(app.getHttpServer())
          .get(`/api/reports/projects/${project.id}/monthly?month=2038-05`)
          .set('Authorization', `Bearer ${tokens.boss}`)
          .expect(200);
        for (const metric of ['income', 'expense', 'profit'] as const) {
          assertGolden(report.body.data[metric], project[metric], project.caseId, `reports.${metric}`);
        }
        assertGolden(report.body.data.recordCount, 2, project.caseId, 'reports.recordCount');

        const answer = await chat(`${project.name}2038年5月收入成本利润是多少？`, project.caseId);
        assertGolden(answer.fallback, false, project.caseId, 'ai.fallback');
        assertGolden(answer.toolsUsed.join(','), 'get_project_summary', project.caseId, 'ai.tools');
        assertGolden(answer.claims.length, 3, project.caseId, 'ai.claims.length');
        for (const metric of ['income', 'expense', 'profit'] as const) {
          const claim = answer.claims.find((item) => item.metric === metric);
          assertGolden(claim?.scopeType, 'project', project.caseId, `claims.${metric}.scopeType`);
          assertGolden(claim?.scopeId, project.id, project.caseId, `claims.${metric}.scopeId`);
          assertGolden(claim?.period, '2038-05', project.caseId, `claims.${metric}.period`);
          assertGolden(claim?.value, report.body.data[metric], project.caseId, `claims.${metric}.value`);
          assertGolden(claim?.unit, 'CNY', project.caseId, `claims.${metric}.unit`);
          assertGolden(claim?.sourceTool, 'get_project_summary', project.caseId, `claims.${metric}.sourceTool`);
          assertGolden(claim?.sourcePath, `data.${metric}`, project.caseId, `claims.${metric}.sourcePath`);
        }
      }

      const rankingQuery = 'period=monthly&date=2038-05-01&metric=profit';
      const projectHighest = await request(app.getHttpServer())
        .get(`/api/reports/ranking?${rankingQuery}&groupBy=project&direction=highest`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      const projectLowest = await request(app.getHttpServer())
        .get(`/api/reports/ranking?${rankingQuery}&groupBy=project&direction=lowest`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      assertGolden(projectHighest.body.data.items.length, 3, 'golden-ranking-project', 'reports.items.length');
      assertGolden(projectHighest.body.data.items[0].scopeId, projectIds[0], 'golden-ranking-project-high', 'reports.scopeId');
      assertGolden(projectLowest.body.data.items[0].scopeId, projectIds[2], 'golden-ranking-project-low', 'reports.scopeId');

      const customerHighest = await request(app.getHttpServer())
        .get(`/api/reports/ranking?${rankingQuery}&groupBy=customer&direction=highest`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      const customerLowest = await request(app.getHttpServer())
        .get(`/api/reports/ranking?${rankingQuery}&groupBy=customer&direction=lowest`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      assertGolden(customerHighest.body.data.items.length, 2, 'golden-ranking-customer', 'reports.items.length');
      assertGolden(customerHighest.body.data.items[0].profit, '1250.00', 'golden-ranking-customer-high', 'reports.profit');
      assertGolden(customerLowest.body.data.items[0].profit, '200.00', 'golden-ranking-customer-low', 'reports.profit');

      const rankingCases = [
        {
          caseId: 'golden-ai-project-high',
          question: '2038年5月哪个项目利润最高？',
          report: projectHighest.body.data,
          scopeType: 'project'
        },
        {
          caseId: 'golden-ai-project-low',
          question: '2038年5月哪个项目利润最低？',
          report: projectLowest.body.data,
          scopeType: 'project'
        },
        {
          caseId: 'golden-ai-customer-low',
          question: '2038年5月哪个客户利润最低？',
          report: customerLowest.body.data,
          scopeType: 'customer'
        }
      ];
      for (const rankingCase of rankingCases) {
        const answer = await chat(rankingCase.question, rankingCase.caseId);
        const claim = answer.claims[0];
        assertGolden(answer.toolsUsed.join(','), 'get_finance_ranking', rankingCase.caseId, 'ai.tools');
        assertGolden(claim?.scopeType, rankingCase.scopeType, rankingCase.caseId, 'claim.scopeType');
        assertGolden(claim?.scopeId, rankingCase.report.items[0].scopeId, rankingCase.caseId, 'claim.scopeId');
        assertGolden(claim?.period, '2038-05', rankingCase.caseId, 'claim.period');
        assertGolden(claim?.metric, 'profit', rankingCase.caseId, 'claim.metric');
        assertGolden(claim?.value, rankingCase.report.items[0].profit, rankingCase.caseId, 'claim.value');
        assertGolden(claim?.sourcePath, 'data.items[0].profit', rankingCase.caseId, 'claim.sourcePath');
      }

      await request(app.getHttpServer())
        .get(`/api/reports/ranking?${rankingQuery}&direction=highest`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(400);
      for (const role of ['employee', 'reviewer'] as const) {
        await request(app.getHttpServer())
          .get(`/api/reports/ranking?${rankingQuery}&groupBy=project&direction=highest`)
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(403);
      }
      for (const role of ['finance', 'employee', 'reviewer'] as const) {
        await request(app.getHttpServer())
          .post('/api/ai/chat')
          .set('Authorization', `Bearer ${tokens[role]}`)
          .send({ message: '2038年5月利润是多少？' })
          .expect(403);
      }
    } finally {
      if (conversationIds.length) {
        await prisma.aiCallLog.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: conversationIds } } });
        await prisma.aiConversation.deleteMany({ where: { id: { in: conversationIds } } });
      }
      if (recordIds.length) {
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: recordIds } } });
        await prisma.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
      }
      await prisma.auditLog.deleteMany({ where: { requestId: { startsWith: requestPrefix } } });
      if (projectIds.length) await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
  });

  it('exposes only safe model deployment metadata and explicit health checks', async () => {
    const tokens = Object.fromEntries(await Promise.all(['finance', 'boss', 'employee'].map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<'finance' | 'boss' | 'employee', string>;

    await request(app.getHttpServer()).get('/api/model-runtime/health').expect(401);
    await request(app.getHttpServer())
      .get('/api/model-runtime/health')
      .set('Authorization', `Bearer ${tokens.employee}`)
      .expect(403);

    const deployments = await request(app.getHttpServer())
      .get('/api/model-runtime/deployments')
      .set('Authorization', `Bearer ${tokens.finance}`)
      .expect(200);
    expect(deployments.body.data).toHaveLength(5);
    expect(deployments.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'mock-text', provider: 'mock', isEnabled: true }),
      expect.objectContaining({ key: 'qwen3-14b-awq', isEnabled: false, secretRef: 'AI_API_KEY' }),
      expect.objectContaining({ key: 'paddleocr-vl', isEnabled: false, secretRef: 'OCR_API_KEY' })
    ]));
    expect(JSON.stringify(deployments.body.data)).not.toContain(String(process.env.JWT_SECRET));

    const routes = await request(app.getHttpServer())
      .get('/api/model-runtime/routes')
      .set('Authorization', `Bearer ${tokens.boss}`)
      .expect(200);
    expect(routes.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskType: 'boss_chat', isEnabled: true, deployment: expect.objectContaining({ key: 'mock-text' }) }),
      expect.objectContaining({ taskType: 'ocr_document_classification', isEnabled: true, deployment: expect.objectContaining({ key: 'mock-text' }) }),
      expect.objectContaining({ taskType: 'ocr_field_mapping', isEnabled: true, deployment: expect.objectContaining({ key: 'mock-text' }) }),
      expect.objectContaining({ taskType: 'report_narrative', isEnabled: true, deployment: expect.objectContaining({ key: 'mock-text' }) }),
      expect.objectContaining({ taskType: 'report_fact_check', isEnabled: true, deployment: expect.objectContaining({ key: 'mock-text' }) }),
      expect.objectContaining({ taskType: 'ocr_document', isEnabled: false, deployment: expect.objectContaining({ key: 'paddleocr-vl' }) })
    ]));

    const health = await request(app.getHttpServer())
      .get('/api/model-runtime/health')
      .set('Authorization', `Bearer ${tokens.finance}`)
      .expect(200);
    expect(health.body.data).toMatchObject({ status: 'ok', deployments: expect.any(Array) });
    expect(health.body.data.deployments).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'mock-text', enabled: true, healthy: true, status: 'healthy' }),
      expect.objectContaining({ key: 'qwen3-14b-awq', enabled: false, healthy: false, status: 'disabled' })
    ]));
    expect(await prisma.modelDeployment.count()).toBe(5);
    expect(await prisma.taskModelRoute.count()).toBe(17);
  });

  it('imports a real XLSX with mapping decisions and rejects partial-row posting', async () => {
    const usernames = ['employee', 'finance', 'boss'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof usernames)[number], string>;
    const reviewerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: '\u8d22\u52a1', password: '123456' })
      .expect(200);
    const reviewerToken = reviewerLogin.body.data.accessToken as string;
    const suffix = Date.now().toString(36);
    const taskIds: string[] = [];
    const rawFileIds: string[] = [];
    const recordIds: string[] = [];
    let projectId: string | undefined;
    let templateId: string | undefined;
    let activeTemplateId: string | undefined;
    let suggestedFieldId: string | undefined;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('费用明细');
    sheet.addRow(['发生日期', '费用金额', '车牌', '司机', '上楼费', '临时说明']);
    sheet.addRow(['2026/07/01', 8200, '粤A12345', '王师傅', 300, '正常']);
    sheet.addRow(['2026/07/02', '错误金额', '粤B77889', '刘师傅', 500, '金额错误']);
    sheet.addRow(['']);
    sheet.addRow(['2026/07/01', 8200, '粤A12345', '王师傅', 300, '正常']);
    sheet.addRow(['2026/02/30', 1000, '粤C10001', '陈师傅', 100, '日期错误']);
    const formulaRow = sheet.addRow(['2026/07/03', null, '粤D20002', '赵师傅', 200, '公式金额']);
    formulaRow.getCell(2).value = { formula: 'SUM(4000,4000)', result: 8000 };
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
    const multiWorkbook = new ExcelJS.Workbook();
    multiWorkbook.addWorksheet('汇总').addRows([
      ['月份', '合计'],
      ['2026-07', 200]
    ]);
    const multiDetail = multiWorkbook.addWorksheet('费用明细');
    multiDetail.addRow(['发生日期', '费用', null, '车牌', '司机']);
    multiDetail.addRow([null, '金额', '说明', null, null]);
    const multiDetailRow = multiDetail.addRow(['2026-07-01', null, '合成明细', '粤A10001', '测试司机']);
    multiDetailRow.getCell(2).value = { formula: 'SUM(120,80)', result: 200 };
    multiDetail.mergeCells('A1:A2');
    multiDetail.mergeCells('B1:C1');
    multiDetail.mergeCells('D1:D2');
    multiDetail.mergeCells('E1:E2');
    const hiddenArchive = multiWorkbook.addWorksheet('历史归档');
    hiddenArchive.state = 'hidden';
    hiddenArchive.addRows([
      ['日期', '金额'],
      ['2025-01-01', 10]
    ]);
    const multiImageId = multiWorkbook.addImage({
      extension: 'png',
      base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    });
    multiDetail.addImage(multiImageId, { tl: { col: 6, row: 0 }, ext: { width: 1, height: 1 } });
    const multiXlsx = Buffer.from(await multiWorkbook.xlsx.writeBuffer());

    try {
      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}excel_${suffix}`,
          customerName: 'Excel customer',
          ownerName: 'Excel owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;
      const template = await prisma.template.create({
        data: {
          name: `${TEST_USER_PREFIX}excel_template_${suffix}`,
          recordType: DataRecordType.cost,
          createdBy: 'finance'
        }
      });
      templateId = template.id;
      activeTemplateId = template.id;
      const standardFields = await prisma.fieldDefinition.findMany({
        where: { fieldKey: { in: ['date', 'amount', 'vehiclePlate', 'driverName'] } }
      });
      expect(standardFields).toHaveLength(4);
      const requiredKeys = new Set(['date', 'amount', 'vehiclePlate', 'driverName']);
      await prisma.templateField.createMany({
        data: standardFields.map((field, index) => ({
          templateId: template.id,
          fieldId: field.id,
          displayOrder: index + 1,
          isRequired: requiredKeys.has(field.fieldKey),
          isVisible: true
        }))
      });
      const amountField = standardFields.find((field) => field.fieldKey === 'amount')!;
      const dateField = standardFields.find((field) => field.fieldKey === 'date')!;
      await prisma.template.update({
        where: { id: template.id },
        data: { primaryAmountFieldId: amountField.id, primaryDateFieldId: dateField.id }
      });
      await prisma.projectTemplate.create({
        data: { projectId: project.id, templateId: template.id, recordType: template.recordType }
      });

      await request(app.getHttpServer())
        .post('/api/import-tasks')
        .set('Authorization', `Bearer ${tokens.employee}`)
        .field('projectId', project.id)
        .field('templateId', template.id)
        .field('importType', DataRecordType.cost)
        .attach('file', xlsx, { filename: 'employee.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        .expect(403);

      const createTask = (key: string, filename: string, contents = xlsx) => request(app.getHttpServer())
        .post('/api/import-tasks')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', key)
        .field('projectId', project.id)
        .field('templateId', activeTemplateId!)
        .field('importType', DataRecordType.cost)
        .attach('file', contents, { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      const created = await createTask(`integration-import-${suffix}-one`, '费用导入.xlsx').expect(201);
      const taskId = created.body.data.id as string;
      const rawFileId = created.body.data.rawFileId as string;
      taskIds.push(taskId);
      rawFileIds.push(rawFileId);
      expect(created.body.data).toMatchObject({
        projectId: project.id,
        templateId: template.id,
        status: ImportTaskStatus.uploaded,
        rawFile: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/), fileSize: xlsx.length }
      });

      const multiCreated = await createTask(
        `integration-import-${suffix}-multi`,
        '多工作表导入.xlsx',
        multiXlsx
      ).expect(201);
      const multiTaskId = multiCreated.body.data.id as string;
      const multiRawFileId = multiCreated.body.data.rawFileId as string;
      taskIds.push(multiTaskId);
      rawFileIds.push(multiRawFileId);

      await request(app.getHttpServer())
        .post(`/api/import-tasks/${multiTaskId}/inspect`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(403);
      const inspected = await request(app.getHttpServer())
        .post(`/api/import-tasks/${multiTaskId}/inspect`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-import-inspect-${suffix}`)
        .expect(201);
      expect(inspected.body.data).toMatchObject({
        requiresSheetSelection: true,
        processingMode: 'streaming',
        mediaCount: 1,
        mediaExpandedBytes: expect.any(Number),
        sheets: [
          { sheetIndex: 0, sheetName: '汇总', state: 'visible' },
          { sheetIndex: 1, sheetName: '费用明细', state: 'visible' },
          { sheetIndex: 2, sheetName: '历史归档', state: 'hidden' }
        ]
      });
      const inspectAudit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'import_task.inspect', resourceId: multiTaskId }
      });
      expect(inspectAudit.metadata).toMatchObject({ processingMode: 'streaming', mediaCount: 1 });
      const inspectLedger = await prisma.ledgerEvent.findFirstOrThrow({
        where: { eventType: 'import_task_inspected', aggregateId: multiTaskId }
      });
      expect(inspectLedger.payload).toMatchObject({ processingMode: 'streaming', mediaCount: 1 });

      await request(app.getHttpServer())
        .post(`/api/import-tasks/${multiTaskId}/parse`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({})
        .expect(400);
      expect(await prisma.importTask.findUniqueOrThrow({ where: { id: multiTaskId } })).toMatchObject({
        status: ImportTaskStatus.uploaded,
        errorMessage: null
      });
      expect(await prisma.rawFile.findUniqueOrThrow({ where: { id: multiRawFileId } })).toMatchObject({
        status: RawFileStatus.uploaded
      });

      const selectedParse = await request(app.getHttpServer())
        .post(`/api/import-tasks/${multiTaskId}/parse`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          sheetIndex: 1,
          headerStartRowIndex: 1,
          headerRowIndex: 2,
          allowCachedFormulaResults: true
        })
        .expect(201);
      expect(selectedParse.body.data).toMatchObject({
        status: ImportTaskStatus.mapping,
        evidence: {
          schemaVersion: 'excel-ir/1.0',
          parserVersion: 'exceljs-evidence-v1',
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          parserInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          irHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          rowEvidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
        },
        sheets: [{
          stableId: 'sheet1',
          index: 1,
          visibility: 'visible',
          headerStartRowIndex: 1,
          headerRowIndex: 2,
          selectedHeaderRows: [1, 2],
          mergedRanges: expect.arrayContaining(['A1:A2', 'B1:C1', 'D1:D2', 'E1:E2']),
          dateSystem: '1900',
          timezone: 'UTC',
          rowCount: 1
        }]
      });
      expect(selectedParse.body.data.columns.map((column: { sourceName: string }) => column.sourceName)).toEqual([
        '发生日期',
        '费用 / 金额',
        '费用 / 说明',
        '车牌',
        '司机'
      ]);
      const cachedFormulaRow = await prisma.importRow.findFirstOrThrow({ where: { importTaskId: multiTaskId } });
      expect(cachedFormulaRow).toMatchObject({
        status: ImportRowStatus.pending,
        evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        cellEvidence: expect.arrayContaining([expect.objectContaining({
          sourceRef: 'sheet1!B3',
          parsedType: 'formula',
          formula: 'SUM(120,80)',
          cachedValue: '200',
          canonicalValue: '200'
        })])
      });
      expect(cachedFormulaRow.rawData).toMatchObject({
        '费用 / 金额': { formula: 'SUM(120,80)', result: 200 }
      });
      expect(cachedFormulaRow.warnings).toContain('费用 / 金额：使用公式缓存结果，确认前必须复核');
      const cachedFormulaAudit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'import_task.parse', resourceId: multiTaskId },
        orderBy: { createdAt: 'desc' }
      });
      expect(cachedFormulaAudit.metadata).toMatchObject({
        allowCachedFormulaResults: true,
        processingMode: 'streaming',
        irSchemaVersion: 'excel-ir/1.0',
        irHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      const cachedFormulaLedger = await prisma.ledgerEvent.findFirstOrThrow({
        where: { eventType: 'import_task_parsed', aggregateId: multiTaskId },
        orderBy: { createdAt: 'desc' }
      });
      expect(cachedFormulaLedger.payload).toMatchObject({
        allowCachedFormulaResults: true,
        processingMode: 'streaming',
        irSchemaVersion: 'excel-ir/1.0',
        irHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      const multiColumns = selectedParse.body.data.columns as Array<{ id: string; sourceName: string }>;
      const multiDateColumn = multiColumns.find((column) => column.sourceName === '发生日期')!;
      const multiAmountColumn = multiColumns.find((column) => column.sourceName === '费用 / 金额')!;
      const multiDescriptionColumn = multiColumns.find((column) => column.sourceName === '费用 / 说明')!;
      const multiVehicleColumn = multiColumns.find((column) => column.sourceName === '车牌')!;
      const multiDriverColumn = multiColumns.find((column) => column.sourceName === '司机')!;
      const vehicleField = standardFields.find((field) => field.fieldKey === 'vehiclePlate')!;
      const driverField = standardFields.find((field) => field.fieldKey === 'driverName')!;
      await request(app.getHttpServer())
        .put(`/api/import-tasks/${multiTaskId}/mappings`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          expectedVersion: selectedParse.body.data.version,
          expectedReviewRevision: selectedParse.body.data.reviewRevision,
          mappings: [
            { columnId: multiDateColumn.id, targetFieldId: dateField.id },
            { columnId: multiAmountColumn.id, targetFieldId: amountField.id },
            { columnId: multiDescriptionColumn.id, ignore: true },
            { columnId: multiVehicleColumn.id, targetFieldId: vehicleField.id },
            { columnId: multiDriverColumn.id, targetFieldId: driverField.id }
          ]
        })
        .expect(200);
      const cachedFormulaPreview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${multiTaskId}/preview`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(cachedFormulaPreview.body.data).toMatchObject({
        summary: { total: 1, valid: 1, errors: 0, duplicates: 0, ignored: 0 },
        rows: [{ amount: '200.00', warnings: ['费用 / 金额：使用公式缓存结果，确认前必须复核'] }]
      });
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${multiTaskId}/cancel`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);

      const parsed = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/parse`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-import-parse-${suffix}`)
        .expect(201);
      expect(parsed.body.data).toMatchObject({
        status: ImportTaskStatus.mapping,
        counts: { total: 6, valid: 3, errors: 1, duplicates: 1, ignored: 1, imported: 0 }
      });
      expect(parsed.body.data.columns).toHaveLength(6);
      const columns = parsed.body.data.columns as Array<{
        id: string;
        sourceName: string;
        decision?: { targetFieldId?: string; mappingType: string; ignored: boolean };
        suggestion?: { id: string };
      }>;
      for (const known of ['发生日期', '费用金额', '车牌', '司机']) {
        expect(columns.find((column) => column.sourceName === known)?.decision?.targetFieldId).toBeTruthy();
      }
      const upstairs = columns.find((column) => column.sourceName === '上楼费');
      const note = columns.find((column) => column.sourceName === '临时说明');
      expect(upstairs?.suggestion?.id).toBeTruthy();
      expect(note?.suggestion?.id).toBeTruthy();

      const storedRows = await prisma.importRow.findMany({ where: { importTaskId: taskId }, orderBy: { rowNumber: 'asc' } });
      expect(storedRows.map((row) => row.status)).toEqual([
        ImportRowStatus.pending,
        ImportRowStatus.pending,
        ImportRowStatus.ignored,
        ImportRowStatus.duplicate,
        ImportRowStatus.pending,
        ImportRowStatus.error
      ]);
      expect(storedRows.every((row) => /^[a-f0-9]{64}$/.test(row.rowHash))).toBe(true);

      const unresolvedPreview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/confirm-preview`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(unresolvedPreview.body.data.unresolvedColumns).toHaveLength(2);
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(400);

      const approved = await request(app.getHttpServer())
        .post(`/api/field-suggestions/${upstairs!.suggestion!.id}/approve`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ fieldName: '上楼费', fieldType: FieldType.money })
        .expect(201);
      suggestedFieldId = approved.body.data.fieldId as string;
      activeTemplateId = approved.body.data.templateId as string;
      expect(activeTemplateId).not.toBe(template.id);
      const mappingReviewState = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });

      const mapped = await request(app.getHttpServer())
        .put(`/api/import-tasks/${taskId}/mappings`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-import-mapping-${suffix}`)
        .send({
          expectedVersion: mappingReviewState.version,
          expectedReviewRevision: mappingReviewState.reviewRevision,
          mappings: [{ columnId: note!.id, ignore: true }],
          saveToProfile: true
        })
        .expect(200);
      expect(mapped.body.data.status).toBe(ImportTaskStatus.pending_confirm);

      const preview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(preview.body.data).toMatchObject({
        unresolvedColumns: [],
        strategy: 'whole_batch_fail_closed',
        summary: { total: 6, valid: 1, errors: 3, duplicates: 1, ignored: 1 }
      });
      expect(preview.body.data.rows.find((row: { rowNumber: number }) => row.rowNumber === 3).errors).toContain('费用金额：数字格式错误');
      expect(preview.body.data.rows.find((row: { rowNumber: number }) => row.rowNumber === 6).errors).toContain('发生日期：日期无效');

      const invalidApproval = await loadImportApproval(taskId, tokens.finance);
      expect(invalidApproval.task.validation?.snapshot).toMatchObject({
        valid: false,
        counts: { total: 6, recordCount: 1, blockingErrorCount: expect.any(Number) }
      });
      expect(invalidApproval.task.validation!.snapshot.blockingErrors.length).toBeGreaterThan(0);
      const rejected = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('Idempotency-Key', `integration-import-confirm-${suffix}`)
        .send(invalidApproval.payload)
        .expect(409);
      expect(rejected.body).toMatchObject({
        code: 40901,
        data: {
          reason: 'IMPORT_VALIDATION_BLOCKING_ERRORS',
          blockingErrorCount: expect.any(Number),
          recordCount: 1
        }
      });
      expect(await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
        status: ImportTaskStatus.pending_confirm,
        importedRows: 0,
        approvalSnapshotHash: null
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'import_task.confirm_scheduled', resourceId: taskId } })).toBe(0);
      expect(await prisma.ledgerEvent.count({ where: { eventType: 'import_task_confirmed', aggregateId: taskId } })).toBe(0);

      const secondCreated = await createTask(`integration-import-${suffix}-two`, '费用导入复用.xlsx').expect(201);
      const secondTaskId = secondCreated.body.data.id as string;
      taskIds.push(secondTaskId);
      rawFileIds.push(secondCreated.body.data.rawFileId as string);
      const secondParsed = await request(app.getHttpServer())
        .post(`/api/import-tasks/${secondTaskId}/parse`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);
      expect(secondParsed.body.data.status).toBe(ImportTaskStatus.pending_confirm);
      const secondColumns = secondParsed.body.data.columns as Array<{
        sourceName: string;
        decision?: { mappingType: string; ignored: boolean; targetFieldId?: string };
        suggestion?: unknown;
      }>;
      expect(secondColumns.find((column) => column.sourceName === '上楼费')?.decision).toMatchObject({
        mappingType: 'profile',
        targetFieldId: suggestedFieldId,
        ignored: false
      });
      expect(secondColumns.find((column) => column.sourceName === '临时说明')?.decision).toMatchObject({
        mappingType: 'ignored',
        ignored: true
      });
      expect(secondColumns.filter((column) => column.suggestion)).toHaveLength(0);
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${secondTaskId}/cancel`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);
    } finally {
      const files = rawFileIds.length
        ? await prisma.rawFile.findMany({ where: { id: { in: rawFileIds } }, select: { id: true, storagePath: true } })
        : [];
      if (recordIds.length || taskIds.length) {
        await prisma.businessRecord.deleteMany({
          where: { OR: [{ id: { in: recordIds } }, { importTaskId: { in: taskIds } }] }
        });
      }
      if (taskIds.length) await prisma.importTask.deleteMany({ where: { id: { in: taskIds } } });
      for (const file of files) await fileStorage.remove(file.storagePath);
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      const templateIds = [templateId, activeTemplateId].filter((id): id is string => Boolean(id));
      if (templateIds.length) await prisma.template.deleteMany({ where: { id: { in: templateIds } } });
      if (suggestedFieldId) await prisma.fieldDefinition.deleteMany({ where: { id: suggestedFieldId } });
      const resourceIds = [...taskIds, ...rawFileIds, ...recordIds, projectId, ...templateIds, suggestedFieldId].filter(
        (id): id is string => Boolean(id)
      );
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
      await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
    }
  });

  describe('B8-01 import confirmation state hardening', () => {
    let financeToken: string;
    let reviewerToken: string;
    let reviewerUserId: string;
    let dateFieldId: string;
    let projectId: string;
    let templateId: string;
    let workbookBuffer: Buffer;
    const taskIds: string[] = [];
    const rawFileIds: string[] = [];
    const suggestionIds: string[] = [];
    const suffix = Date.now().toString(36);

    beforeAll(async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'finance', password: '123456' })
        .expect(200);
      financeToken = login.body.data.accessToken as string;
      const reviewerLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: '\u8d22\u52a1', password: '123456' })
        .expect(200);
      reviewerToken = reviewerLogin.body.data.accessToken as string;
      reviewerUserId = reviewerLogin.body.data.user.id as string;
      const [dateField, amountField] = await Promise.all([
        prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'date' } }),
        prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'amount' } })
      ]);
      dateFieldId = dateField.id;
      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}b8_state_${suffix}`,
          customerName: 'B8 state customer',
          ownerName: 'B8 state owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;
      const template = await prisma.template.create({
        data: {
          name: `${TEST_USER_PREFIX}b8_state_template_${suffix}`,
          recordType: DataRecordType.cost,
          primaryDateFieldId: dateField.id,
          primaryAmountFieldId: amountField.id,
          createdBy: 'finance'
        }
      });
      templateId = template.id;
      await prisma.templateField.createMany({
        data: [
          { templateId, fieldId: dateField.id, isRequired: true, isVisible: true, displayOrder: 1 },
          { templateId, fieldId: amountField.id, isRequired: true, isVisible: true, displayOrder: 2 }
        ]
      });
      await prisma.projectTemplate.create({
        data: { projectId, templateId, recordType: DataRecordType.cost }
      });

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('B8 state');
      sheet.addRow(['date', 'amount']);
      sheet.addRow(['2026-07-15', 125.5]);
      workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    });

    afterAll(async () => {
      const records = projectId
        ? await prisma.businessRecord.findMany({
          where: { projectId },
          select: { id: true }
        })
        : [];
      const files = rawFileIds.length
        ? await prisma.rawFile.findMany({
          where: { id: { in: rawFileIds } },
          select: { id: true, storagePath: true }
        })
        : [];
      if (projectId) await prisma.businessRecord.deleteMany({ where: { projectId } });
      if (taskIds.length) {
        await prisma.importTask.deleteMany({ where: { id: { in: taskIds } } });
      }
      for (const file of files) await fileStorage.remove(file.storagePath);
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      const resourceIds = [
        ...taskIds,
        ...rawFileIds,
        ...records.map((record) => record.id),
        ...suggestionIds,
        projectId,
        templateId
      ].filter((id): id is string => Boolean(id));
      if (resourceIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      }
    });

    const createPendingTask = async (label: string) => {
      const created = await request(app.getHttpServer())
        .post('/api/import-tasks')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', `b8-state-${suffix}-${label}`)
        .field('projectId', projectId)
        .field('templateId', templateId)
        .field('importType', DataRecordType.cost)
        .attach('file', workbookBuffer, {
          filename: `${label}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
        .expect(201);
      const taskId = created.body.data.id as string;
      const rawFileId = created.body.data.rawFileId as string;
      taskIds.push(taskId);
      rawFileIds.push(rawFileId);
      const parsed = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/parse`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({})
        .expect(201);
      expect(parsed.body.data.status).toBe(ImportTaskStatus.pending_confirm);
      const columnId = parsed.body.data.columns[0].id as string;
      return { taskId, rawFileId, columnId };
    };

    const expectNoConfirmationSideEffects = async (taskId: string) => {
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(0);
      expect(await prisma.importRow.count({
        where: {
          importTaskId: taskId,
          OR: [{ status: ImportRowStatus.confirmed }, { generatedRecordId: { not: null } }]
        }
      })).toBe(0);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.confirm', resourceId: taskId }
      })).toBe(0);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_confirmed', aggregateId: taskId }
      })).toBe(0);
    };

    const waitingAdvisoryLocks = async () => {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count"
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND NOT granted
      `;
      return Number(row.count);
    };

    const waitForAdvisoryWaiters = async (minimum: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await waitingAdvisoryLocks() >= minimum) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for ${minimum} advisory lock waiters`);
    };

    const queueBehindTaskLock = async (
      taskId: string,
      first: () => request.Test,
      second: () => request.Test
    ): Promise<[request.Response, request.Response]> => {
      let firstResponse!: Promise<request.Response>;
      let secondResponse!: Promise<request.Response>;
      await prisma.$transaction(async (tx) => {
        const baseline = await waitingAdvisoryLocks();
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${taskId}, 9))`;
        firstResponse = first().then((response) => response);
        await waitForAdvisoryWaiters(baseline + 1);
        secondResponse = second().then((response) => response);
        await waitForAdvisoryWaiters(baseline + 2);
      }, { maxWait: 5_000, timeout: 10_000 });
      return [await firstResponse, await secondResponse];
    };

    const confirmRequest = (
      taskId: string,
      payload: ReturnType<typeof approvalPayloadFromTask>,
      key: string
    ) => request(app.getHttpServer())
      .post(`/api/import-tasks/${taskId}/confirm`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .set('Idempotency-Key', key)
      .send(payload);
    const cancelRequest = (taskId: string) => request(app.getHttpServer())
      .post(`/api/import-tasks/${taskId}/cancel`)
      .set('Authorization', `Bearer ${financeToken}`);

    it('confirms only pending_confirm tasks and keeps cancelled tasks terminal', async () => {
      const pending = await createPendingTask('pending-success');
      const pendingApproval = await loadImportApproval(pending.taskId, financeToken);
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${pending.taskId}/confirm`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', `b8-state-${suffix}-self-approval`)
        .send(pendingApproval.payload)
        .expect(403)
        .expect(({ body }) => {
          expect(body.data.reason).toBe('IMPORT_SELF_APPROVAL_FORBIDDEN');
        });
      const pendingKey = `b8-state-${suffix}-pending-success-confirm`;
      const firstConfirm = await confirmRequest(pending.taskId, pendingApproval.payload, pendingKey).expect(201);
      expect(firstConfirm.body.data).toMatchObject({
        task: { status: ImportTaskStatus.confirming },
        alreadyConfirmed: false,
        importedRows: 0,
        recordIds: []
      });
      expect(await waitForImportConfirmation(pending.taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: 1
      });
      const secondConfirm = await confirmRequest(pending.taskId, pendingApproval.payload, pendingKey).expect(201);
      expect(secondConfirm.body).toEqual(firstConfirm.body);
      expect(await prisma.businessRecord.count({ where: { importTaskId: pending.taskId } })).toBe(1);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.confirm', resourceId: pending.taskId }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_confirmed', aggregateId: pending.taskId }
      })).toBe(1);
      const [confirmedRecord] = await prisma.businessRecord.findMany({
        where: { importTaskId: pending.taskId },
        select: { id: true }
      });
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'business_record_created', aggregateId: confirmedRecord.id }
      })).toBe(1);
      expect(await prisma.importRow.count({
        where: {
          importTaskId: pending.taskId,
          status: ImportRowStatus.confirmed,
          generatedRecordId: { not: null }
        }
      })).toBe(1);

      const invalidStatuses = [
        ImportTaskStatus.uploaded,
        ImportTaskStatus.parsing,
        ImportTaskStatus.parsed,
        ImportTaskStatus.mapping,
        ImportTaskStatus.failed
      ];
      for (const status of invalidStatuses) {
        const invalid = await createPendingTask(`invalid-${status}`);
        const invalidApproval = await loadImportApproval(invalid.taskId, financeToken);
        await prisma.importTask.update({
          where: { id: invalid.taskId },
          data: { status, leaseToken: null, leaseUntil: null }
        });
        const response = await confirmRequest(
          invalid.taskId,
          invalidApproval.payload,
          `b8-state-${suffix}-invalid-${status}-confirm`
        ).expect(409);
        expect(response.body).toMatchObject({ code: 40901, data: {} });
        expect(await prisma.importTask.findUniqueOrThrow({ where: { id: invalid.taskId } })).toMatchObject({
          status,
          importedRows: 0,
          confirmedAt: null,
          confirmedBy: null
        });
        await expectNoConfirmationSideEffects(invalid.taskId);
      }

      const cancelled = await createPendingTask('cancelled-terminal');
      const cancelledApproval = await loadImportApproval(cancelled.taskId, financeToken);
      const cancelledColumns = await prisma.importColumn.findMany({
        where: { importTaskId: cancelled.taskId },
        orderBy: { columnIndex: 'asc' }
      });
      const [mapSuggestion, rejectSuggestion] = await Promise.all([
        prisma.fieldSuggestion.create({
          data: {
            projectId,
            templateId,
            importTaskId: cancelled.taskId,
            importColumnId: cancelledColumns[0].id,
            sourceName: cancelledColumns[0].sourceName,
            suggestedFieldName: 'B8 map suggestion',
            suggestedFieldType: FieldType.date,
            sampleValues: []
          }
        }),
        prisma.fieldSuggestion.create({
          data: {
            projectId,
            templateId,
            importTaskId: cancelled.taskId,
            importColumnId: cancelledColumns[1].id,
            sourceName: cancelledColumns[1].sourceName,
            suggestedFieldName: 'B8 reject suggestion',
            suggestedFieldType: FieldType.money,
            sampleValues: []
          }
        })
      ]);
      suggestionIds.push(mapSuggestion.id, rejectSuggestion.id);
      await cancelRequest(cancelled.taskId).expect(201);
      for (const response of [
        await confirmRequest(
          cancelled.taskId,
          cancelledApproval.payload,
          `b8-state-${suffix}-cancelled-confirm`
        ),
        await request(app.getHttpServer())
          .post(`/api/import-tasks/${cancelled.taskId}/parse`)
          .set('Authorization', `Bearer ${financeToken}`)
          .send({}),
        await request(app.getHttpServer())
          .put(`/api/import-tasks/${cancelled.taskId}/mappings`)
          .set('Authorization', `Bearer ${financeToken}`)
          .send({
            expectedVersion: cancelledApproval.task.version,
            expectedReviewRevision: cancelledApproval.task.reviewRevision,
            mappings: [{ columnId: cancelled.columnId, ignore: true }]
          }),
        await request(app.getHttpServer())
          .post(`/api/field-suggestions/${mapSuggestion.id}/map`)
          .set('Authorization', `Bearer ${financeToken}`)
          .send({ fieldId: dateFieldId }),
        await request(app.getHttpServer())
          .post(`/api/field-suggestions/${rejectSuggestion.id}/reject`)
          .set('Authorization', `Bearer ${financeToken}`)
      ]) {
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 40901, data: {} });
      }
      await app.get(ImportTasksService).recoverExpiredParses();
      expect(await prisma.fieldSuggestion.findMany({
        where: { id: { in: [mapSuggestion.id, rejectSuggestion.id] } },
        orderBy: { id: 'asc' },
        select: { status: true }
      })).toEqual([
        { status: FieldSuggestionStatus.pending },
        { status: FieldSuggestionStatus.pending }
      ]);
      expect(await prisma.importTask.findUniqueOrThrow({ where: { id: cancelled.taskId } })).toMatchObject({
        status: ImportTaskStatus.cancelled,
        leaseToken: null,
        leaseUntil: null
      });
      await expectNoConfirmationSideEffects(cancelled.taskId);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.cancel', resourceId: cancelled.taskId }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_cancelled', aggregateId: cancelled.taskId }
      })).toBe(1);
    });

    it('serializes cancel and confirm with deterministic lock ordering', async () => {
      const cancelWins = await createPendingTask('race-cancel-wins');
      const cancelWinsApproval = await loadImportApproval(cancelWins.taskId, financeToken);
      const [cancelFirst, confirmSecond] = await queueBehindTaskLock(
        cancelWins.taskId,
        () => cancelRequest(cancelWins.taskId),
        () => confirmRequest(
          cancelWins.taskId,
          cancelWinsApproval.payload,
          `b8-state-${suffix}-race-cancel-wins-confirm`
        )
      );
      expect([cancelFirst.status, confirmSecond.status]).toEqual([201, 409]);
      expect(confirmSecond.body).toMatchObject({ code: 40901, data: {} });
      expect(await prisma.importTask.findUniqueOrThrow({ where: { id: cancelWins.taskId } })).toMatchObject({
        status: ImportTaskStatus.cancelled,
        importedRows: 0
      });
      await expectNoConfirmationSideEffects(cancelWins.taskId);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.cancel', resourceId: cancelWins.taskId }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_cancelled', aggregateId: cancelWins.taskId }
      })).toBe(1);

      const confirmWins = await createPendingTask('race-confirm-wins');
      const confirmWinsApproval = await loadImportApproval(confirmWins.taskId, financeToken);
      const [confirmFirst, cancelSecond] = await queueBehindTaskLock(
        confirmWins.taskId,
        () => confirmRequest(
          confirmWins.taskId,
          confirmWinsApproval.payload,
          `b8-state-${suffix}-race-confirm-wins-confirm`
        ),
        () => cancelRequest(confirmWins.taskId)
      );
      expect([confirmFirst.status, cancelSecond.status]).toEqual([201, 409]);
      expect(cancelSecond.body).toMatchObject({ code: 40901, data: {} });
      expect(await waitForImportConfirmation(confirmWins.taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: 1,
        confirmedBy: reviewerUserId
      });
      const confirmedRecords = await prisma.businessRecord.findMany({
        where: { importTaskId: confirmWins.taskId },
        select: { id: true }
      });
      expect(confirmedRecords).toHaveLength(1);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.confirm', resourceId: confirmWins.taskId }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_confirmed', aggregateId: confirmWins.taskId }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'business_record_created', aggregateId: confirmedRecords[0].id }
      })).toBe(1);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.cancel', resourceId: confirmWins.taskId }
      })).toBe(0);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_cancelled', aggregateId: confirmWins.taskId }
      })).toBe(0);
    });
  });

  describe('B8-02 Excel preview and confirmation consistency', () => {
    let financeToken: string;
    let reviewerToken: string;
    let projectId: string;
    let templateId: string;
    let dateFieldId: string;
    let amountFieldId: string;
    let defaultFieldId: string;
    let hiddenFieldId: string;
    let inactiveFieldId: string;
    let externalFieldId: string;
    let precisionFieldId: string;
    let precisionTemplateFieldId: string;
    const taskIds: string[] = [];
    const rawFileIds: string[] = [];
    const suffix = Date.now().toString(36);

    beforeAll(async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'finance', password: '123456' })
        .expect(200);
      financeToken = login.body.data.accessToken as string;
      const reviewerLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: '\u8d22\u52a1', password: '123456' })
        .expect(200);
      reviewerToken = reviewerLogin.body.data.accessToken as string;
      const [dateField, amountField, defaultField] = await Promise.all([
        prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'date' } }),
        prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'amount' } }),
        prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'costCategory' } })
      ]);
      dateFieldId = dateField.id;
      amountFieldId = amountField.id;
      defaultFieldId = defaultField.id;
      const [hiddenField, inactiveField, externalField, precisionField] = await Promise.all([
        prisma.fieldDefinition.create({
          data: {
            fieldKey: `b8_hidden_${suffix}`,
            fieldName: 'B8 hidden field',
            fieldType: FieldType.text,
            semanticType: SemanticType.category
          }
        }),
        prisma.fieldDefinition.create({
          data: {
            fieldKey: `b8_inactive_${suffix}`,
            fieldName: 'B8 inactive field',
            fieldType: FieldType.text,
            semanticType: SemanticType.category,
            isActive: false
          }
        }),
        prisma.fieldDefinition.create({
          data: {
            fieldKey: `b8_external_${suffix}`,
            fieldName: 'B8 external field',
            fieldType: FieldType.text,
            semanticType: SemanticType.category
          }
        }),
        prisma.fieldDefinition.create({
          data: {
            fieldKey: `b8_precision_${suffix}`,
            fieldName: 'B8 precision default',
            fieldType: FieldType.number,
            semanticType: SemanticType.amount
          }
        })
      ]);
      hiddenFieldId = hiddenField.id;
      inactiveFieldId = inactiveField.id;
      externalFieldId = externalField.id;
      precisionFieldId = precisionField.id;

      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}b8_preview_${suffix}`,
          customerName: 'B8 preview customer',
          ownerName: 'B8 preview owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;
      const template = await prisma.template.create({
        data: {
          name: `${TEST_USER_PREFIX}b8_preview_template_${suffix}`,
          recordType: DataRecordType.cost,
          primaryDateFieldId: dateFieldId,
          primaryAmountFieldId: amountFieldId,
          createdBy: 'finance'
        }
      });
      templateId = template.id;
      const templateFields = await Promise.all([
        prisma.templateField.create({
          data: { templateId, fieldId: dateFieldId, isRequired: true, isVisible: true, displayOrder: 1 }
        }),
        prisma.templateField.create({
          data: { templateId, fieldId: amountFieldId, isRequired: true, isVisible: true, displayOrder: 2 }
        }),
        prisma.templateField.create({
          data: {
            templateId,
            fieldId: defaultFieldId,
            isRequired: true,
            isVisible: true,
            displayOrder: 3,
            defaultValue: '运输成本'
          }
        }),
        prisma.templateField.create({
          data: { templateId, fieldId: hiddenFieldId, isRequired: false, isVisible: false, displayOrder: 4 }
        }),
        prisma.templateField.create({
          data: { templateId, fieldId: inactiveFieldId, isRequired: false, isVisible: true, displayOrder: 5 }
        }),
        prisma.templateField.create({
          data: { templateId, fieldId: precisionFieldId, isRequired: false, isVisible: true, displayOrder: 6 }
        })
      ]);
      precisionTemplateFieldId = templateFields[5].id;
      await prisma.projectTemplate.create({
        data: { projectId, templateId, recordType: DataRecordType.cost }
      });
    });

    afterAll(async () => {
      const records = projectId
        ? await prisma.businessRecord.findMany({
          where: { projectId },
          select: { id: true }
        })
        : [];
      const files = projectId
        ? await prisma.rawFile.findMany({
          where: { relatedProjectId: projectId },
          select: { id: true, storagePath: true }
        })
        : [];
      if (projectId) {
        await prisma.businessRecord.deleteMany({ where: { projectId } });
        await prisma.importTask.deleteMany({ where: { projectId } });
      }
      for (const file of files) await fileStorage.remove(file.storagePath);
      if (files.length) await prisma.rawFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: 'b8-' } } });
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      const customFieldIds = [hiddenFieldId, inactiveFieldId, externalFieldId, precisionFieldId].filter(Boolean);
      if (customFieldIds.length) {
        await prisma.fieldDefinition.deleteMany({ where: { id: { in: customFieldIds } } });
      }
      const resourceIds = [
        ...taskIds,
        ...rawFileIds,
        ...records.map((record) => record.id),
        projectId,
        templateId,
        ...customFieldIds
      ].filter((id): id is string => Boolean(id));
      if (resourceIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      }
    });

    const createAndParse = async (label: string, headers: string[], rows: unknown[][]) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('B8 preview');
      sheet.addRow(headers);
      for (const row of rows) sheet.addRow(row);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const created = await request(app.getHttpServer())
        .post('/api/import-tasks')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', `b8-preview-${suffix}-${label}`)
        .field('projectId', projectId)
        .field('templateId', templateId)
        .field('importType', DataRecordType.cost)
        .attach('file', buffer, {
          filename: `${label}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
        .expect(201);
      const taskId = created.body.data.id as string;
      taskIds.push(taskId);
      rawFileIds.push(created.body.data.rawFileId as string);
      const parsed = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/parse`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({})
        .expect(201);
      return { taskId, parsed: parsed.body.data as { status: ImportTaskStatus; columns: Array<{
        id: string;
        sourceName: string;
        decision?: { targetFieldId?: string };
      }> } };
    };

    it('applies typed defaults and rejects canonical row errors before confirmation', async () => {
      const { taskId, parsed } = await createAndParse('defaults-boundaries', ['date', 'amount'], [
        ['2026-07-15', 8765.43],
        ['2026-07-16', 0],
        ['2026-07-17', -10],
        ['2026-07-18', 1.234],
        ['2026-02-30', 500]
      ]);
      expect(parsed.status).toBe(ImportTaskStatus.pending_confirm);

      const preview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(preview.body.data.summary).toEqual({ total: 5, valid: 1, errors: 4, duplicates: 0, ignored: 0 });
      expect(preview.body.data.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 5,
        totalPages: 1,
        hasNext: false
      });
      expect(preview.body.data.rows[0]).toMatchObject({
        status: ImportRowStatus.mapped,
        amount: '8765.43',
        recordDate: '2026-07-15',
        values: expect.arrayContaining([
          expect.objectContaining({ fieldId: defaultFieldId, value: '运输成本' })
        ])
      });
      for (const row of preview.body.data.rows.slice(1)) {
        expect(row.status).toBe(ImportRowStatus.error);
        expect(row.errors.length).toBeGreaterThan(0);
      }

      const firstPage = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=1&pageSize=2`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(firstPage.body.data.rows).toHaveLength(2);
      expect(firstPage.body.data.pagination).toEqual({
        page: 1,
        pageSize: 2,
        total: 5,
        totalPages: 3,
        hasNext: true
      });
      expect(Buffer.byteLength(JSON.stringify(firstPage.body), 'utf8')).toBeLessThan(256 * 1024);

      const repeatedFirstPage = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=1&pageSize=2`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(repeatedFirstPage.body.data.rows.map((row: { id: string }) => row.id))
        .toEqual(firstPage.body.data.rows.map((row: { id: string }) => row.id));

      const lastPage = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=3&pageSize=2`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(lastPage.body.data.rows.map((row: { rowNumber: number }) => row.rowNumber)).toEqual([6]);
      expect(lastPage.body.data.pagination).toMatchObject({ page: 3, pageSize: 2, total: 5, hasNext: false });

      const deepPage = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=999&pageSize=1`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(deepPage.body.data.rows).toEqual([]);
      expect(deepPage.body.data.pagination).toMatchObject({ page: 999, pageSize: 1, total: 5, hasNext: false });

      const maximumPage = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=1&pageSize=100`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(maximumPage.body.data.rows).toHaveLength(5);

      await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=0`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?pageSize=101`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=50001`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?status=error`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview`)
        .expect(401);

      const cached = await prisma.importTask.findUniqueOrThrow({
        where: { id: taskId },
        select: { version: true, previewSummaryVersion: true }
      });
      expect(cached.previewSummaryVersion).toBe(cached.version);

      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/auto-match`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(201);
      const invalidated = await prisma.importTask.findUniqueOrThrow({
        where: { id: taskId },
        select: { version: true, previewSummaryVersion: true }
      });
      expect(invalidated.previewSummaryVersion).not.toBe(invalidated.version);
      const refreshed = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=1&pageSize=2`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(refreshed.body.data.summary).toEqual(preview.body.data.summary);

      const invalidApproval = await loadImportApproval(taskId, financeToken);
      expect(invalidApproval.task.validation?.snapshot).toMatchObject({
        valid: false,
        counts: { total: 5, recordCount: 1, blockingErrorCount: expect.any(Number) }
      });
      const rejected = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('Idempotency-Key', `b8-preview-${suffix}-invalid-confirm`)
        .send(invalidApproval.payload)
        .expect(409);
      expect(rejected.body).toMatchObject({
        code: 40901,
        data: { reason: 'IMPORT_VALIDATION_BLOCKING_ERRORS', recordCount: 1 }
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(0);
      expect(await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
        status: ImportTaskStatus.pending_confirm,
        importedRows: 0,
        approvalSnapshotHash: null
      });
    });

    it('posts each valid detail row once and requires explicit exclusion of a summary row', async () => {
      const { taskId } = await createAndParse(
        'detail-and-summary',
        ['date', 'amount'],
        [
          ['2026-07-15', 100],
          ['\u5408\u8ba1', 100]
        ]
      );
      const preview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(preview.body.data).toMatchObject({
        strategy: 'whole_batch_fail_closed',
        summary: { total: 2, valid: 1, errors: 1, duplicates: 0, ignored: 0 }
      });
      const [detailRow, summaryRow] = preview.body.data.rows as Array<{
        id: string;
        rowNumber: number;
        summaryCandidate: boolean;
      }>;
      expect(detailRow.summaryCandidate).toBe(false);
      expect(summaryRow.summaryCandidate).toBe(true);

      const current = preview.body.data.task as ImportApprovalView;
      const reviewBody = {
        expectedVersion: current.version,
        expectedReviewRevision: current.reviewRevision,
        decision: 'exclude',
        reason: 'Summary row must not be posted with its detail rows'
      };
      await request(app.getHttpServer())
        .put(`/api/import-tasks/${taskId}/rows/${detailRow.id}/review`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send(reviewBody)
        .expect(409)
        .expect(({ body }) => {
          expect(body.data.reason).toBe('IMPORT_ROW_REVIEW_NOT_SUMMARY');
        });

      await request(app.getHttpServer())
        .put(`/api/import-tasks/${taskId}/rows/${summaryRow.id}/review`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send(reviewBody)
        .expect(200);
      let approval = await loadImportApproval(taskId, financeToken);
      expect(approval.task.validation?.snapshot).toMatchObject({
        valid: true,
        counts: { total: 2, recordCount: 1, blockingErrorCount: 0 }
      });
      expect(approval.payload.acknowledgedWarningIds.length).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .put(`/api/import-tasks/${taskId}/rows/${summaryRow.id}/review`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          expectedVersion: approval.task.version,
          expectedReviewRevision: approval.task.reviewRevision,
          decision: 'exclude',
          reason: 'Finance confirmed the summary exclusion after validation'
        })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('Idempotency-Key', `b8-preview-${suffix}-summary-stale-validation`)
        .send(approval.payload)
        .expect(409)
        .expect(({ body }) => {
          expect(body.data.reason).toBe('IMPORT_APPROVAL_VERSION_CONFLICT');
        });
      approval = await loadImportApproval(taskId, financeToken);

      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('Idempotency-Key', `b8-preview-${suffix}-summary-warning-missing`)
        .send({ ...approval.payload, acknowledgedWarningIds: [] })
        .expect(409)
        .expect(({ body }) => {
          expect(body.data.reason).toBe('IMPORT_WARNING_ACKNOWLEDGEMENT_MISMATCH');
        });
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', `b8-preview-${suffix}-summary-self-approval`)
        .send(approval.payload)
        .expect(403)
        .expect(({ body }) => {
          expect(body.data.reason).toBe('IMPORT_SELF_APPROVAL_FORBIDDEN');
        });

      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('Idempotency-Key', `b8-preview-${suffix}-summary-confirm`)
        .send(approval.payload)
        .expect(201);
      expect(await waitForImportConfirmation(taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: 1,
        ignoredRows: 1,
        errorRows: 0
      });
      const records = await prisma.businessRecord.findMany({ where: { importTaskId: taskId } });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        sourceId: detailRow.id,
        sourceType: RecordSourceType.excel,
        status: BusinessRecordStatus.confirmed
      });
      expect(records[0].amount.toFixed(2)).toBe('100.00');
      expect(await prisma.auditLog.count({
        where: { action: 'import_row.review', resourceId: summaryRow.id }
      })).toBe(2);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_confirmed', aggregateId: taskId }
      })).toBe(1);
    });

    it('rejects approval when the source file security state changes after validation', async () => {
      const { taskId } = await createAndParse(
        'source-invalidated-after-validation',
        ['date', 'amount'],
        [['2026-07-15', 100]]
      );
      const approval = await loadImportApproval(taskId, financeToken);
      const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
      await prisma.rawFile.update({ where: { id: task.rawFileId }, data: { isVoided: true } });

      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('Idempotency-Key', `b8-preview-${suffix}-source-invalidated`)
        .send(approval.payload)
        .expect(409)
        .expect(({ body }) => {
          expect(body.data.reason).toBe('IMPORT_SOURCE_SECURITY_STATE_CHANGED');
        });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(0);
      expect(await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
        status: ImportTaskStatus.pending_confirm,
        approvalSnapshotHash: null,
        importedRows: 0
      });
    });

    it('never maps hidden, inactive, or non-template fields', async () => {
      const hiddenKey = `b8_hidden_${suffix}`;
      const inactiveKey = `b8_inactive_${suffix}`;
      const { taskId, parsed } = await createAndParse(
        'field-boundaries',
        ['date', 'amount', hiddenKey, inactiveKey],
        [['2026-07-15', 100, 'hidden', 'inactive']]
      );
      expect(parsed.status).toBe(ImportTaskStatus.mapping);
      const hiddenColumn = parsed.columns.find((column) => column.sourceName === hiddenKey)!;
      const inactiveColumn = parsed.columns.find((column) => column.sourceName === inactiveKey)!;
      expect(hiddenColumn.decision).toBeUndefined();
      expect(inactiveColumn.decision).toBeUndefined();
      const fieldBoundaryReviewState = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });

      for (const [columnId, targetFieldId] of [
        [hiddenColumn.id, hiddenFieldId],
        [inactiveColumn.id, inactiveFieldId],
        [hiddenColumn.id, externalFieldId]
      ]) {
        const response = await request(app.getHttpServer())
          .put(`/api/import-tasks/${taskId}/mappings`)
          .set('Authorization', `Bearer ${financeToken}`)
          .send({
            expectedVersion: fieldBoundaryReviewState.version,
            expectedReviewRevision: fieldBoundaryReviewState.reviewRevision,
            mappings: [{ columnId, targetFieldId }]
          })
          .expect(400);
        expect(response.body).toMatchObject({ code: 40001, data: {} });
      }
    });

    it('binds import creation keys to the original canonical upload request and response', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('B8 import idempotency');
      sheet.addRow(['date', 'amount']);
      sheet.addRow(['2026-07-15', 100]);
      const originalBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      sheet.addRow(['2026-07-16', 200]);
      const changedBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const key = `b8-import-create-${suffix}`;
      const upload = (buffer: Buffer) => request(app.getHttpServer())
        .post('/api/import-tasks')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', key)
        .field('projectId', projectId)
        .field('templateId', templateId)
        .field('importType', DataRecordType.cost)
        .attach('file', buffer, {
          filename: 'b8-idempotency.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

      const first = await upload(originalBuffer).expect(201);
      const taskId = first.body.data.id as string;
      taskIds.push(taskId);
      rawFileIds.push(first.body.data.rawFileId as string);
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/parse`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({})
        .expect(201);
      const replay = await upload(originalBuffer).expect(201);
      const conflict = await upload(changedBuffer).expect(409);
      expect(replay.body).toEqual(first.body);
      expect(conflict.body).toMatchObject({ code: 40901, data: {} });
      const storedTask = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
      expect(storedTask.idempotencyKey).toMatch(/^idem-v1:[a-f0-9]{64}$/);
      expect(storedTask.idempotencyKey).not.toContain(key);
    });

    const manualRecordPayload = (amount = '250.00', description = 'B8 manual idempotency') => ({
      projectId,
      templateId,
      recordType: DataRecordType.cost,
      recordDate: '2026-07-15',
      amount,
      sourceType: RecordSourceType.manual,
      sourceId: 'manual',
      status: BusinessRecordStatus.pending_confirm,
      description,
      values: [
        { fieldId: dateFieldId, value: '2026-07-15' },
        { fieldId: amountFieldId, value: amount }
      ],
      attachments: []
    });

    const createManualRecord = (key: string, amount = '250.00') => request(app.getHttpServer())
      .post('/api/records')
      .set('Authorization', `Bearer ${financeToken}`)
      .set('Idempotency-Key', key)
      .send(manualRecordPayload(amount, key));

    it('persists manual record creation idempotency and rejects key reuse with another body', async () => {
      const key = `b8-record-create-${suffix}`;
      const first = await createManualRecord(key).expect(201);
      const replay = await createManualRecord(key).expect(201);
      const conflict = await createManualRecord(key, '251.00').expect(409);
      expect(replay.body).toEqual(first.body);
      expect(conflict.body).toMatchObject({
        code: 40901,
        data: { reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' }
      });
      expect(await prisma.businessRecord.count({
        where: { projectId, sourceType: RecordSourceType.manual, description: key }
      })).toBe(1);
    });

    it('rolls back a failed financial operation and releases its idempotency key', async () => {
      const key = `b8-record-rollback-${suffix}`;
      await request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', key)
        .send(manualRecordPayload('invalid-money', key))
        .expect(400);
      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);

      const recovered = await createManualRecord(key, '252.00').expect(201);
      expect(recovered.body.data).toMatchObject({ amount: '252.00', description: key });
      expect(await prisma.idempotencyKey.count({
        where: { key, status: 'completed', responseStatus: 201 }
      })).toBe(1);
    });

    it('serializes concurrent manual record creation under one idempotency key', async () => {
      const key = `b8-record-create-race-${suffix}`;
      const [first, second] = await Promise.all([
        createManualRecord(key),
        createManualRecord(key)
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body).toEqual(second.body);
      expect(await prisma.businessRecord.count({
        where: { projectId, sourceType: RecordSourceType.manual, description: key }
      })).toBe(1);
    });

    it('replays manual record updates and rejects a changed payload under the same key', async () => {
      const created = await createManualRecord(`b8-record-update-source-${suffix}`).expect(201);
      const recordId = created.body.data.id as string;
      const key = `b8-record-update-${suffix}`;
      const update = (description: string) => request(app.getHttpServer())
        .patch(`/api/records/${recordId}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', key)
        .send({ description });

      const first = await update('idempotent update').expect(200);
      const replay = await update('idempotent update').expect(200);
      expect(replay.body).toEqual(first.body);
      await update('changed update').expect(409).expect(({ body }) => {
        expect(body.data.reason).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
      });
      expect(await prisma.auditLog.count({
        where: { resourceId: recordId, action: 'business_record.update' }
      })).toBe(1);
    });

    it('scopes record confirmation keys to one canonical target', async () => {
      const firstRecord = await createManualRecord(`b8-record-confirm-source-a-${suffix}`).expect(201);
      const secondRecord = await createManualRecord(`b8-record-confirm-source-b-${suffix}`, '300.00').expect(201);
      const key = `b8-record-confirm-${suffix}`;
      const confirm = (id: string) => request(app.getHttpServer())
        .post(`/api/records/${id}/confirm`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', key);
      const first = await confirm(firstRecord.body.data.id).expect(201);
      const replay = await confirm(firstRecord.body.data.id).expect(201);
      const conflict = await confirm(secondRecord.body.data.id).expect(409);
      expect(replay.body).toEqual(first.body);
      expect(conflict.body).toMatchObject({ code: 40901, data: {} });
      expect(await prisma.businessRecord.count({
        where: { id: { in: [firstRecord.body.data.id, secondRecord.body.data.id] }, status: BusinessRecordStatus.confirmed }
      })).toBe(1);
    });

    it('scopes Excel confirmation keys to one import task', async () => {
      const firstTask = await createAndParse(
        'confirm-idempotency-a',
        ['date', 'amount'],
        [['2026-07-20', 410]]
      );
      const secondTask = await createAndParse(
        'confirm-idempotency-b',
        ['date', 'amount'],
        [['2026-07-21', 420]]
      );
      const firstApproval = await loadImportApproval(firstTask.taskId, financeToken);
      const secondApproval = await loadImportApproval(secondTask.taskId, financeToken);
      const key = `b8-import-confirm-${suffix}`;
      const confirm = (taskId: string, payload: ReturnType<typeof approvalPayloadFromTask>) => request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .set('Idempotency-Key', key)
        .send(payload);
      const first = await confirm(firstTask.taskId, firstApproval.payload).expect(201);
      const replay = await confirm(firstTask.taskId, firstApproval.payload).expect(201);
      const conflict = await confirm(secondTask.taskId, secondApproval.payload).expect(409);
      expect(replay.body).toEqual(first.body);
      expect(conflict.body).toMatchObject({ code: 40901, data: {} });
      expect(await waitForImportConfirmation(firstTask.taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: 1
      });
      expect(await prisma.businessRecord.count({
        where: { importTaskId: { in: [firstTask.taskId, secondTask.taskId] } }
      })).toBe(1);
    });

    it('marks an invalid typed template default as a preview error', async () => {
      await prisma.templateField.update({
        where: { id: precisionTemplateFieldId },
        data: { isRequired: true, defaultValue: '1.23456' }
      });
      const { taskId } = await createAndParse(
        'invalid-default',
        ['date', 'amount'],
        [['2026-07-15', 100]]
      );
      const preview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(preview.body.data.summary).toEqual({ total: 1, valid: 0, errors: 1, duplicates: 0, ignored: 0 });
      expect(preview.body.data.rows[0]).toMatchObject({
        status: ImportRowStatus.error,
        errors: expect.arrayContaining([expect.stringContaining('B8 precision default')])
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(0);
    });
  });

  describe('M3 mapping profile structural scope', () => {
    it('reuses only exact project structures and invalidates stale or revoked profiles', async () => {
      const suffix = randomUUID().slice(0, 8);
      const taskIds: string[] = [];
      const rawFileIds: string[] = [];
      const projectIds: string[] = [];
      let templateId: string | undefined;

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'finance', password: '123456' })
        .expect(200);
      const token = login.body.data.accessToken as string;
      const fields = await prisma.fieldDefinition.findMany({
        where: { fieldKey: { in: ['date', 'amount'] } }
      });
      const dateField = fields.find((field) => field.fieldKey === 'date')!;
      const amountField = fields.find((field) => field.fieldKey === 'amount')!;
      expect(dateField).toBeDefined();
      expect(amountField).toBeDefined();

      const buildWorkbook = async (headers: string[]) => {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('结构 测试');
        sheet.addRow(headers);
        const valuesByHeader = new Map([
          [`m3_day_${suffix}`, '2026-07-18'],
          [`m3_money_${suffix}`, '100.25']
        ]);
        sheet.addRow(headers.map((header) => valuesByHeader.get(header)));
        return Buffer.from(await workbook.xlsx.writeBuffer());
      };

      try {
        const template = await prisma.template.create({
          data: {
            name: `${TEST_USER_PREFIX}m3_profile_template_${suffix}`,
            recordType: DataRecordType.cost,
            primaryDateFieldId: dateField.id,
            primaryAmountFieldId: amountField.id,
            createdBy: 'finance'
          }
        });
        templateId = template.id;
        await prisma.templateField.createMany({
          data: [
            { templateId: template.id, fieldId: dateField.id, displayOrder: 1, isRequired: true },
            { templateId: template.id, fieldId: amountField.id, displayOrder: 2, isRequired: true }
          ]
        });
        const projects = await Promise.all(['a', 'b'].map((label) => prisma.project.create({
          data: {
            name: `${TEST_USER_PREFIX}m3_profile_${label}_${suffix}`,
            customerName: 'Synthetic customer',
            ownerName: 'Synthetic owner',
            createdBy: 'finance'
          }
        })));
        projectIds.push(...projects.map((project) => project.id));
        await prisma.projectTemplate.createMany({
          data: projects.map((project) => ({
            projectId: project.id,
            templateId: template.id,
            recordType: template.recordType
          }))
        });

        const headers = [`m3_day_${suffix}`, `m3_money_${suffix}`];
        const createAndParse = async (projectId: string, orderedHeaders: string[], label: string) => {
          const contents = await buildWorkbook(orderedHeaders);
          const created = await request(app.getHttpServer())
            .post('/api/import-tasks')
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', `m3-profile-${suffix}-${label}`)
            .field('projectId', projectId)
            .field('templateId', template.id)
            .field('importType', DataRecordType.cost)
            .attach('file', contents, {
              filename: `${label}.xlsx`,
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            })
            .expect(201);
          const taskId = created.body.data.id as string;
          taskIds.push(taskId);
          rawFileIds.push(created.body.data.rawFileId as string);
          const parsed = await request(app.getHttpServer())
            .post(`/api/import-tasks/${taskId}/parse`)
            .set('Authorization', `Bearer ${token}`)
            .send({ sheetIndex: 0, headerStartRowIndex: 1, headerRowIndex: 1 })
            .expect(201);
          return { taskId, data: parsed.body.data };
        };

        const saveMappings = async (
          taskId: string,
          task: { version: number; reviewRevision: number; columns: Array<{ id: string; sourceName: string }> }
        ) => {
          await request(app.getHttpServer())
            .put(`/api/import-tasks/${taskId}/mappings`)
            .set('Authorization', `Bearer ${token}`)
            .send({
              expectedVersion: task.version,
              expectedReviewRevision: task.reviewRevision,
              mappings: task.columns.map((column) => ({
                columnId: column.id,
                targetFieldId: column.sourceName === headers[0] ? dateField.id : amountField.id
              })),
              saveToProfile: true
            })
            .expect(200);
        };

        const first = await createAndParse(projects[0].id, headers, 'first');
        expect(first.data.mappingProfile.profileId).toBeUndefined();
        await saveMappings(first.taskId, first.data);
        const firstStored = await prisma.importTask.findUniqueOrThrow({ where: { id: first.taskId } });
        expect(firstStored).toMatchObject({
          mappingProfileId: expect.any(String),
          mappingProfileVersion: 1,
          structureFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
          mappingProfileSnapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/)
        });
        const firstProfileId = firstStored.mappingProfileId!;

        const exact = await createAndParse(projects[0].id, headers, 'exact');
        expect(exact.data.mappingProfile).toMatchObject({
          profileId: firstProfileId,
          profileVersion: 1,
          structureFingerprint: firstStored.structureFingerprint
        });
        expect(exact.data.columns.map((column: { decision?: { mappingType: string } }) => column.decision?.mappingType))
          .toEqual([MappingDecisionType.profile, MappingDecisionType.profile]);

        const firstRule = await prisma.mappingProfileRule.findFirstOrThrow({
          where: { mappingProfileId: firstProfileId },
          orderBy: { columnIndex: 'asc' }
        });
        await expect(prisma.mappingProfileRule.update({
          where: { id: firstRule.id },
          data: { transformKey: 'UNSAFE_EXPRESSION' }
        })).rejects.toThrow();
        await prisma.mappingProfile.update({
          where: { id: firstProfileId },
          data: { approvalSnapshotHash: 'b'.repeat(64) }
        });
        const tampered = await createAndParse(projects[0].id, headers, 'tampered-profile');
        expect(tampered.data.mappingProfile.profileId).toBeUndefined();
        expect(await prisma.mappingProfile.findUniqueOrThrow({ where: { id: firstProfileId } })).toMatchObject({
          status: MappingProfileStatus.stale,
          isActive: false
        });
        expect(await prisma.businessRecord.count({ where: { importTaskId: tampered.taskId } })).toBe(0);
        await saveMappings(tampered.taskId, tampered.data);
        expect(await prisma.mappingProfile.findUniqueOrThrow({ where: { id: firstProfileId } })).toMatchObject({
          status: MappingProfileStatus.active,
          isActive: true,
          profileVersion: 2
        });

        const otherProject = await createAndParse(projects[1].id, headers, 'other-project');
        expect(otherProject.data.mappingProfile.profileId).toBeUndefined();
        expect(otherProject.data.columns.some(
          (column: { decision?: { mappingType: string } }) => column.decision?.mappingType === MappingDecisionType.profile
        )).toBe(false);

        const changedHeaders = [...headers].reverse();
        const changed = await createAndParse(projects[0].id, changedHeaders, 'changed');
        expect(changed.data.mappingProfile.profileId).toBeUndefined();
        await saveMappings(changed.taskId, changed.data);
        expect(await prisma.mappingProfile.findUniqueOrThrow({ where: { id: firstProfileId } })).toMatchObject({
          status: MappingProfileStatus.stale,
          isActive: false
        });
        const changedStored = await prisma.importTask.findUniqueOrThrow({ where: { id: changed.taskId } });
        expect(changedStored.mappingProfileId).not.toBe(firstProfileId);

        const reapplied = await createAndParse(projects[0].id, changedHeaders, 'reapplied');
        expect(reapplied.data.mappingProfile.profileId).toBe(changedStored.mappingProfileId);
        await request(app.getHttpServer())
          .post(`/api/mapping-profiles/${changedStored.mappingProfileId}/revoke`)
          .set('Authorization', `Bearer ${token}`)
          .expect(201);
        expect(await prisma.mappingProfile.findUniqueOrThrow({ where: { id: changedStored.mappingProfileId! } }))
          .toMatchObject({ status: MappingProfileStatus.revoked, isActive: false });
        expect(await prisma.mappingDecision.count({
          where: { importTaskId: reapplied.taskId, mappingType: MappingDecisionType.profile }
        })).toBe(0);
        expect(await prisma.importTask.findUniqueOrThrow({ where: { id: reapplied.taskId } })).toMatchObject({
          status: ImportTaskStatus.mapping,
          mappingProfileId: null,
          mappingProfileVersion: null
        });
        expect(await prisma.auditLog.count({
          where: { action: 'mapping_profile.revoke', resourceId: changedStored.mappingProfileId! }
        })).toBe(1);
      } finally {
        if (taskIds.length) await prisma.importTask.deleteMany({ where: { id: { in: taskIds } } });
        if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
        if (projectIds.length) await prisma.mappingProfile.deleteMany({ where: { projectId: { in: projectIds } } });
        if (templateId) await prisma.templateField.deleteMany({ where: { templateId } });
        if (projectIds.length) await prisma.projectTemplate.deleteMany({ where: { projectId: { in: projectIds } } });
        if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
        if (projectIds.length) await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      }
    });
  });

  describe('B8-03 background Excel confirmation', () => {
    let financeToken: string;
    let financeUserId: string;
    let reviewerToken: string;
    let reviewerUserId: string;
    let projectId: string;
    let templateId: string;
    let dateFieldId: string;
    let amountFieldId: string;
    const taskIds: string[] = [];
    const rawFileIds: string[] = [];
    const suffix = Date.now().toString(36);

    beforeAll(async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'finance', password: '123456' })
        .expect(200);
      financeToken = login.body.data.accessToken as string;
      financeUserId = login.body.data.user.id as string;
      const reviewerLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: '\u8d22\u52a1', password: '123456' })
        .expect(200);
      reviewerToken = reviewerLogin.body.data.accessToken as string;
      reviewerUserId = reviewerLogin.body.data.user.id as string;
      const [dateField, amountField] = await Promise.all([
        prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'date' } }),
        prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'amount' } })
      ]);
      dateFieldId = dateField.id;
      amountFieldId = amountField.id;
      const project = await prisma.project.create({
        data: {
          name: `${TEST_USER_PREFIX}b8_confirm_${suffix}`,
          customerName: 'B8 confirmation customer',
          ownerName: 'B8 confirmation owner',
          createdBy: 'finance'
        }
      });
      projectId = project.id;
      const template = await prisma.template.create({
        data: {
          name: `${TEST_USER_PREFIX}b8_confirm_template_${suffix}`,
          recordType: DataRecordType.cost,
          primaryDateFieldId: dateFieldId,
          primaryAmountFieldId: amountFieldId,
          createdBy: 'finance'
        }
      });
      templateId = template.id;
      await prisma.templateField.createMany({
        data: [
          { templateId, fieldId: dateFieldId, isRequired: true, isVisible: true, displayOrder: 1 },
          { templateId, fieldId: amountFieldId, isRequired: true, isVisible: true, displayOrder: 2 }
        ]
      });
      await prisma.projectTemplate.create({
        data: { projectId, templateId, recordType: DataRecordType.cost }
      });
    });

    const stopBackgroundConfirmationsForCleanup = async (currentTaskIds: string[]) => {
      if (currentTaskIds.length === 0) return;
      const activeTasks = await prisma.importTask.findMany({
        where: { id: { in: currentTaskIds }, status: ImportTaskStatus.confirming },
        select: { id: true }
      });
      for (const task of activeTasks) {
        await prisma.importTask.updateMany({
          where: { id: task.id, status: ImportTaskStatus.confirming },
          data: {
            leaseToken: `integration-cleanup:${randomUUID()}`,
            leaseUntil: new Date(Date.now() + 10 * 60_000)
          }
        });
      }
      const service = app.get(ImportTasksService) as unknown as {
        backgroundJobs: Map<string, Promise<void>>;
      };
      const taskIdSet = new Set(currentTaskIds);
      const running = [...service.backgroundJobs.entries()]
        .filter(([jobKey]) => {
          const [, taskId] = jobKey.split(':');
          return taskIdSet.has(taskId);
        })
        .map(([, job]) => job);
      await Promise.allSettled(running);
    };

    afterEach(async () => {
      const currentTaskIds = [...taskIds];
      const currentRawFileIds = [...rawFileIds];
      await stopBackgroundConfirmationsForCleanup(currentTaskIds);
      if (currentTaskIds.length > 0) {
        await prisma.$executeRaw(Prisma.sql`
          DELETE FROM ledger_events AS event
          USING business_records AS record
          WHERE event.aggregate_id = record.id
            AND record.import_task_id IN (${Prisma.join(currentTaskIds)})
        `);
        await prisma.businessRecord.deleteMany({ where: { importTaskId: { in: currentTaskIds } } });
        await prisma.importTask.deleteMany({ where: { id: { in: currentTaskIds } } });
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: currentTaskIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: currentTaskIds } } });
      }
      if (currentRawFileIds.length > 0) {
        await prisma.rawFile.deleteMany({ where: { id: { in: currentRawFileIds } } });
      }
      taskIds.length = 0;
      rawFileIds.length = 0;
    }, 240_000);

    afterAll(async () => {
      await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: `b8-confirm-${suffix}` } } });
      await prisma.$executeRaw`
        DELETE FROM ledger_events AS event
        USING business_records AS record
        WHERE event.aggregate_id = record.id
          AND record.project_id = ${projectId}
      `;
      await prisma.businessRecord.deleteMany({ where: { projectId } });
      if (taskIds.length) await prisma.importTask.deleteMany({ where: { id: { in: taskIds } } });
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      const resourceIds = [...taskIds, projectId, templateId];
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
      await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.template.deleteMany({ where: { id: templateId } });
    }, 120_000);

    const createTask = async (rowCount: number, recordDate = '2026-07-15') => {
      const rawFile = await prisma.rawFile.create({
        data: {
          fileName: `b8-confirm-${rowCount}.xlsx`,
          originalFileName: `b8-confirm-${rowCount}.xlsx`,
          fileType: 'excel',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: BigInt(rowCount),
          storagePath: `b8-confirm/${suffix}-${rowCount}.xlsx`,
          sha256: createHash('sha256').update(`${suffix}:${rowCount}`).digest('hex'),
          uploadedBy: financeUserId,
          relatedProjectId: projectId,
          status: RawFileStatus.parsed,
          scanStatus: FileScanStatus.clean
        }
      });
      rawFileIds.push(rawFile.id);
      const task = await prisma.importTask.create({
        data: {
          projectId,
          templateId,
          rawFileId: rawFile.id,
          fileName: rawFile.originalFileName,
          importType: DataRecordType.cost,
          status: ImportTaskStatus.pending_confirm,
          uploadedBy: financeUserId,
          sourceSha256: rawFile.sha256,
          parserInputSha256: rawFile.sha256,
          irSchemaVersion: 'excel-ir/1.0',
          parserVersion: 'integration-fixture/1.0',
          irHash: createHash('sha256').update(`${rawFile.sha256}:ir`).digest('hex'),
          rowEvidenceDigest: createHash('sha256').update(`${rawFile.sha256}:rows`).digest('hex'),
          parsedAt: new Date(),
          processedRows: rowCount,
          totalRows: rowCount,
          validRows: rowCount,
          executionMode: 'background',
          processingMode: 'streaming'
        }
      });
      taskIds.push(task.id);
      const sheet = await prisma.importSheet.create({
        data: {
          importTaskId: task.id,
          sheetName: 'B8 confirmation',
          sheetIndex: 0,
          headerRowIndex: 1,
          rowCount
        }
      });
      const [dateColumn, amountColumn] = await Promise.all([
        prisma.importColumn.create({
          data: {
            importTaskId: task.id,
            sheetId: sheet.id,
            columnIndex: 0,
            sourceKey: 'date',
            sourceName: '日期',
            normalizedName: '日期',
            inferredType: 'date'
          }
        }),
        prisma.importColumn.create({
          data: {
            importTaskId: task.id,
            sheetId: sheet.id,
            columnIndex: 1,
            sourceKey: 'amount',
            sourceName: '金额',
            normalizedName: '金额',
            inferredType: 'number'
          }
        })
      ]);
      await prisma.mappingDecision.createMany({
        data: [
          {
            importTaskId: task.id,
            importColumnId: dateColumn.id,
            targetFieldId: dateFieldId,
            mappingType: MappingDecisionType.manual,
            confidence: new Prisma.Decimal(1),
            confirmedBy: financeUserId
          },
          {
            importTaskId: task.id,
            importColumnId: amountColumn.id,
            targetFieldId: amountFieldId,
            mappingType: MappingDecisionType.manual,
            confidence: new Prisma.Decimal(1),
            confirmedBy: financeUserId
          }
        ]
      });
      for (let offset = 0; offset < rowCount; offset += 1000) {
        const size = Math.min(1000, rowCount - offset);
        await prisma.importRow.createMany({
          data: Array.from({ length: size }, (_, index) => {
            const rowNumber = offset + index + 2;
            return {
              importTaskId: task.id,
              sheetId: sheet.id,
              rowNumber,
              rawData: { date: recordDate, amount: '1.23' },
              rowHash: createHash('sha256').update(`${task.id}:${rowNumber}`).digest('hex'),
              status: ImportRowStatus.pending
            };
          })
        });
      }
      return task.id;
    };

    const confirmRequest = (
      taskId: string,
      payload: ReturnType<typeof approvalPayloadFromTask>,
      key: string
    ) => request(app.getHttpServer())
      .post(`/api/import-tasks/${taskId}/confirm`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .set('Idempotency-Key', key)
      .send(payload);

    const queueWithoutRunningWorker = async (taskId: string, key: string) => {
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        scheduleBackgroundConfirmation(job: unknown): Promise<void>;
      };
      const scheduler = jest.spyOn(service, 'scheduleBackgroundConfirmation').mockResolvedValue();
      try {
        await confirmRequest(taskId, approval.payload, key).expect(201);
      } finally {
        scheduler.mockRestore();
      }
      return approval;
    };

    const waitForTerminalStatus = async (taskId: string, timeoutMs = 120_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
        if (
          task.status === ImportTaskStatus.confirmed ||
          task.status === ImportTaskStatus.confirmation_failed
        ) return task;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const [task, recordCount, processedRowCount] = await Promise.all([
        prisma.importTask.findUnique({
          where: { id: taskId },
          select: {
            status: true,
            confirmationProcessedRows: true,
            confirmationSuccessRows: true,
            confirmationErrorRows: true,
            confirmationAttempts: true,
            leaseUntil: true,
            errorMessage: true
          }
        }),
        prisma.businessRecord.count({ where: { importTaskId: taskId } }),
        prisma.importRow.count({ where: { importTaskId: taskId, confirmationProcessedAt: { not: null } } })
      ]);
      throw new Error(`Timed out waiting for import confirmation ${taskId}: ${JSON.stringify({
        task,
        recordCount,
        processedRowCount
      })}`);
    };

    const waitForConfirmationProgress = async (taskId: string, minimum: number, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
        if (task.status === ImportTaskStatus.confirming && task.confirmationProcessedRows >= minimum) return task;
        if (task.status !== ImportTaskStatus.confirming) {
          throw new Error(`Import confirmation ${taskId} left confirming before reaching ${minimum} rows`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for import confirmation progress ${taskId}`);
    };

    it('keeps unpublished staging unreachable through generic record APIs', async () => {
      const taskId = await createTask(3, '2026-07-18');
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        completeBackgroundConfirmation(
          job: { taskId: string },
          integrity: unknown
        ): Promise<void>;
      };
      const originalCompletion = service.completeBackgroundConfirmation.bind(service);
      let signalCompletionEntered!: () => void;
      let releaseCompletion!: () => void;
      const completionEntered = new Promise<void>((resolve) => {
        signalCompletionEntered = resolve;
      });
      const completionHold = new Promise<void>((resolve) => {
        releaseCompletion = resolve;
      });
      const completionSpy = jest
        .spyOn(service, 'completeBackgroundConfirmation')
        .mockImplementation(async (job, integrity) => {
          if (job.taskId !== taskId) return originalCompletion(job, integrity);
          signalCompletionEntered();
          await completionHold;
          throw new Error('integration publication hold released');
        });

      try {
        await request(app.getHttpServer())
          .post(`/api/import-tasks/${taskId}/confirm`)
          .set('Authorization', `Bearer ${financeToken}`)
          .set('Idempotency-Key', `b8-confirm-${suffix}-staging-self-approval`)
          .send(approval.payload)
          .expect(403)
          .expect(({ body }) => {
            expect(body.data.reason).toBe('IMPORT_SELF_APPROVAL_FORBIDDEN');
          });
        expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(0);

        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-staging-api-boundary`
        ).expect(201);
        await Promise.race([
          completionEntered,
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error(`Timed out waiting for staged records for ${taskId}`)),
            30_000
          ))
        ]);

        const staged = await prisma.businessRecord.findMany({
          where: { importTaskId: taskId },
          orderBy: { id: 'asc' },
          select: { id: true }
        });
        expect(staged).toHaveLength(3);

        const listResponse = await request(app.getHttpServer())
          .get(`/api/records?importTaskId=${taskId}&page=1&pageSize=20`)
          .set('Authorization', `Bearer ${financeToken}`);
        const detailResponse = await request(app.getHttpServer())
          .get(`/api/records/${staged[0].id}`)
          .set('Authorization', `Bearer ${financeToken}`);
        const projectRecordsResponse = await request(app.getHttpServer())
          .get(`/api/projects/${projectId}/records?importTaskId=${taskId}&page=1&pageSize=20`)
          .set('Authorization', `Bearer ${financeToken}`);
        const structureResponse = await request(app.getHttpServer())
          .get(`/api/projects/${projectId}/structure`)
          .set('Authorization', `Bearer ${financeToken}`);
        const patchResponse = await request(app.getHttpServer())
          .patch(`/api/records/${staged[0].id}`)
          .set('Authorization', `Bearer ${reviewerToken}`)
          .set('Idempotency-Key', `b8-confirm-${suffix}-staging-generic-patch`)
          .send({ description: 'must never mutate unpublished staging' });
        const confirmResponse = await request(app.getHttpServer())
          .post(`/api/records/${staged[1].id}/confirm`)
          .set('Authorization', `Bearer ${reviewerToken}`)
          .set('Idempotency-Key', `b8-confirm-${suffix}-staging-generic-confirm`);
        const voidResponse = await request(app.getHttpServer())
          .delete(`/api/records/${staged[2].id}`)
          .set('Authorization', `Bearer ${reviewerToken}`);
        const stored = await prisma.businessRecord.findMany({
          where: { importTaskId: taskId },
          orderBy: { id: 'asc' },
          select: { status: true, version: true, confirmedAt: true, voidedAt: true }
        });

        expect({
          listStatus: listResponse.status,
          listTotal: listResponse.body.data?.total,
          detailStatus: detailResponse.status,
          projectRecordsStatus: projectRecordsResponse.status,
          projectRecordsTotal: projectRecordsResponse.body.data?.total,
          structureStatus: structureResponse.status,
          structureContainsStaging: structureResponse.body.data?.records?.some(
            (record: { id: string }) => staged.some((item) => item.id === record.id)
          ),
          patchStatus: patchResponse.status,
          confirmStatus: confirmResponse.status,
          voidStatus: voidResponse.status,
          stored
        }).toEqual({
          listStatus: 200,
          listTotal: 0,
          detailStatus: 404,
          projectRecordsStatus: 200,
          projectRecordsTotal: 0,
          structureStatus: 200,
          structureContainsStaging: false,
          patchStatus: 404,
          confirmStatus: 404,
          voidStatus: 404,
          stored: [
            { status: BusinessRecordStatus.pending_confirm, version: 1, confirmedAt: null, voidedAt: null },
            { status: BusinessRecordStatus.pending_confirm, version: 1, confirmedAt: null, voidedAt: null },
            { status: BusinessRecordStatus.pending_confirm, version: 1, confirmedAt: null, voidedAt: null }
          ]
        });
      } finally {
        releaseCompletion();
        completionSpy.mockRestore();
        await waitForTerminalStatus(taskId);
      }
    });

    it('fails publication closed after staged record and value tampering', async () => {
      const taskId = await createTask(2, '2026-07-19');
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        prepareBackgroundConfirmationCompletion(job: { taskId: string }): Promise<unknown>;
      };
      const originalPreparation = service.prepareBackgroundConfirmationCompletion.bind(service);
      let signalPreparationEntered!: () => void;
      let releasePreparation!: () => void;
      const preparationEntered = new Promise<void>((resolve) => {
        signalPreparationEntered = resolve;
      });
      const preparationHold = new Promise<void>((resolve) => {
        releasePreparation = resolve;
      });
      const preparationSpy = jest
        .spyOn(service, 'prepareBackgroundConfirmationCompletion')
        .mockImplementation(async (job) => {
          if (job.taskId !== taskId) return originalPreparation(job);
          signalPreparationEntered();
          await preparationHold;
          return originalPreparation(job);
        });

      try {
        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-staging-tamper`
        ).expect(201);
        await Promise.race([
          preparationEntered,
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error(`Timed out waiting for publication preparation for ${taskId}`)),
            30_000
          ))
        ]);

        const staged = await prisma.businessRecord.findFirstOrThrow({
          where: { importTaskId: taskId },
          orderBy: { id: 'asc' }
        });
        await prisma.$transaction([
          prisma.businessRecord.update({
            where: { id: staged.id },
            data: {
              status: BusinessRecordStatus.draft,
              amount: new Prisma.Decimal('999.99'),
              version: { increment: 1 }
            }
          }),
          prisma.recordValue.updateMany({
            where: { recordId: staged.id, fieldId: amountFieldId },
            data: { valueNumber: new Prisma.Decimal('999.99') }
          })
        ]);
        releasePreparation();

        const terminal = await waitForTerminalStatus(taskId);
        const visible = await request(app.getHttpServer())
          .get(`/api/records?importTaskId=${taskId}&page=1&pageSize=20`)
          .set('Authorization', `Bearer ${financeToken}`)
          .expect(200);
        expect({ status: terminal.status, visibleTotal: visible.body.data.total }).toEqual({
          status: ImportTaskStatus.confirmation_failed,
          visibleTotal: 0
        });
        expect(await prisma.businessRecord.count({
          where: {
            importTaskId: taskId,
            publicationStatus: BusinessRecordPublicationStatus.unpublished
          }
        })).toBe(2);
        expect(await prisma.auditLog.count({
          where: { resourceId: taskId, action: 'import_task.confirm' }
        })).toBe(0);
        expect(await prisma.ledgerEvent.count({
          where: { aggregateId: taskId, eventType: 'import_task_confirmed' }
        })).toBe(0);

        const retryApproval = await loadImportApproval(taskId, financeToken, false);
        await confirmRequest(
          taskId,
          retryApproval.payload,
          `b8-confirm-${suffix}-staging-tamper-retry`
        ).expect(201);
        expect(await waitForTerminalStatus(taskId)).toMatchObject({
          status: ImportTaskStatus.confirmed,
          importedRows: 2,
          confirmationAttempts: 2
        });
        expect(await prisma.businessRecord.count({
          where: {
            importTaskId: taskId,
            publicationStatus: BusinessRecordPublicationStatus.published,
            status: BusinessRecordStatus.confirmed
          }
        })).toBe(2);
        expect(await prisma.businessRecord.count({
          where: {
            importTaskId: taskId,
            publicationStatus: BusinessRecordPublicationStatus.unpublished
          }
        })).toBe(0);
      } finally {
        releasePreparation();
        preparationSpy.mockRestore();
        await waitForTerminalStatus(taskId);
      }
    });

    it('fails publication closed when sealed source evidence changes after integrity preparation', async () => {
      const taskId = await createTask(2, '2026-07-19');
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        completeBackgroundConfirmation(
          job: { taskId: string },
          integrity: unknown
        ): Promise<void>;
      };
      const originalCompletion = service.completeBackgroundConfirmation.bind(service);
      let signalCompletionEntered!: () => void;
      let releaseCompletion!: () => void;
      const completionEntered = new Promise<void>((resolve) => {
        signalCompletionEntered = resolve;
      });
      const completionHold = new Promise<void>((resolve) => {
        releaseCompletion = resolve;
      });
      const completionSpy = jest
        .spyOn(service, 'completeBackgroundConfirmation')
        .mockImplementation(async (job, integrity) => {
          if (job.taskId !== taskId) return originalCompletion(job, integrity);
          signalCompletionEntered();
          await completionHold;
          return originalCompletion(job, integrity);
        });

      try {
        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-sealed-source-tamper`
        ).expect(201);
        await Promise.race([
          completionEntered,
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error(`Timed out waiting for final publication for ${taskId}`)),
            30_000
          ))
        ]);

        const sealedRow = await prisma.importRow.findFirstOrThrow({
          where: {
            importTaskId: taskId,
            generatedRecordHash: { not: null }
          },
          orderBy: { rowNumber: 'asc' }
        });
        await prisma.importRow.update({
          where: { id: sealedRow.id },
          data: { normalizedData: { tamperedAfterIntegrityPreparation: true } }
        });
        const invalidatedRecord = await prisma.businessRecord.findUniqueOrThrow({
          where: { id: sealedRow.generatedRecordId! },
          select: { version: true, stagingContentHash: true }
        });
        expect(invalidatedRecord).toEqual({ version: 2, stagingContentHash: null });
        releaseCompletion();

        expect(await waitForTerminalStatus(taskId)).toMatchObject({
          status: ImportTaskStatus.confirmation_failed,
          importedRows: 0,
          confirmedAt: null,
          confirmedBy: null
        });
        expect(await prisma.businessRecord.count({
          where: {
            importTaskId: taskId,
            publicationStatus: BusinessRecordPublicationStatus.published
          }
        })).toBe(0);
        expect(await prisma.auditLog.count({
          where: { resourceId: taskId, action: 'import_task.confirm' }
        })).toBe(0);
        expect(await prisma.ledgerEvent.count({
          where: { aggregateId: taskId, eventType: 'import_task_confirmed' }
        })).toBe(0);
      } finally {
        releaseCompletion();
        completionSpy.mockRestore();
        await waitForTerminalStatus(taskId);
      }
    });

    it('rolls back every publication write when PostgreSQL affects fewer records than approved', async () => {
      const taskId = await createTask(3, '2026-07-20');
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        completeBackgroundConfirmation(
          job: { taskId: string },
          integrity: unknown
        ): Promise<void>;
      };
      const originalCompletion = service.completeBackgroundConfirmation.bind(service);
      let suppressionInstalled = false;
      const dropSuppression = async () => {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS "integration_suppress_one_publication" ON "business_records"'
        );
        await prisma.$executeRawUnsafe(
          'DROP FUNCTION IF EXISTS "integration_suppress_one_publication"()'
        );
        await prisma.$executeRawUnsafe(
          'DROP TABLE IF EXISTS "integration_publication_suppression"'
        );
      };
      const installSuppression = async () => {
        await dropSuppression();
        await prisma.$executeRawUnsafe(
          'CREATE TABLE "integration_publication_suppression" ("task_id" TEXT PRIMARY KEY)'
        );
        await prisma.$executeRaw`
          INSERT INTO "integration_publication_suppression" ("task_id") VALUES (${taskId})
        `;
        await prisma.$executeRawUnsafe(`
          CREATE FUNCTION "integration_suppress_one_publication"() RETURNS trigger AS $$
          BEGIN
            IF OLD."publication_status" = 'unpublished'
               AND NEW."publication_status" = 'published'
               AND EXISTS (
                 SELECT 1 FROM "integration_publication_suppression" AS suppression
                 WHERE suppression."task_id" = OLD."import_task_id"
               )
               AND OLD."id" = (
                 SELECT MIN(candidate."id")
                 FROM "business_records" AS candidate
                 WHERE candidate."import_task_id" = OLD."import_task_id"
                   AND candidate."publication_status" = 'unpublished'
               )
            THEN
              DELETE FROM "integration_publication_suppression"
              WHERE "task_id" = OLD."import_task_id";
              RETURN NULL;
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER "integration_suppress_one_publication"
          BEFORE UPDATE ON "business_records"
          FOR EACH ROW EXECUTE FUNCTION "integration_suppress_one_publication"()
        `);
      };
      const completionSpy = jest
        .spyOn(service, 'completeBackgroundConfirmation')
        .mockImplementation(async (job, integrity) => {
          if (job.taskId === taskId && !suppressionInstalled) {
            suppressionInstalled = true;
            await installSuppression();
          }
          return originalCompletion(job, integrity);
        });

      try {
        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-publication-rowcount`
        ).expect(201);
        expect(await waitForTerminalStatus(taskId)).toMatchObject({
          status: ImportTaskStatus.confirmation_failed,
          importedRows: 0,
          confirmedAt: null,
          confirmedBy: null
        });
        expect(await prisma.businessRecord.count({
          where: {
            importTaskId: taskId,
            publicationStatus: BusinessRecordPublicationStatus.published
          }
        })).toBe(0);
        expect(await prisma.businessRecord.count({
          where: {
            importTaskId: taskId,
            publicationStatus: BusinessRecordPublicationStatus.unpublished,
            status: BusinessRecordStatus.pending_confirm
          }
        })).toBe(3);
        expect(await prisma.importRow.count({
          where: { importTaskId: taskId, status: ImportRowStatus.confirmed }
        })).toBe(0);
        expect(await prisma.ledgerEvent.count({
          where: { aggregateId: taskId, eventType: 'import_task_confirmed' }
        })).toBe(0);
        expect(await prisma.ledgerEvent.count({
          where: {
            aggregateType: 'business_record',
            eventType: 'business_record_created',
            aggregateId: {
              in: (await prisma.businessRecord.findMany({
                where: { importTaskId: taskId },
                select: { id: true }
              })).map((record) => record.id)
            }
          }
        })).toBe(0);
      } finally {
        completionSpy.mockRestore();
        await dropSuppression();
      }

      const retryApproval = await loadImportApproval(taskId, financeToken, false);
      await confirmRequest(
        taskId,
        retryApproval.payload,
        `b8-confirm-${suffix}-publication-rowcount-retry`
      ).expect(201);
      expect(await waitForTerminalStatus(taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: 3,
        confirmationAttempts: 2
      });
      expect(await prisma.businessRecord.count({
        where: {
          importTaskId: taskId,
          publicationStatus: BusinessRecordPublicationStatus.published,
          status: BusinessRecordStatus.confirmed
        }
      })).toBe(3);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: taskId, eventType: 'import_task_confirmed' }
      })).toBe(1);
    });

    it('confirms 5,001 rows through a fast asynchronous API and a complete business-data closure', async () => {
      const rowCount = 5_001;
      const taskId = await createTask(rowCount);
      const preview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=1&pageSize=20`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(preview.body.data.rows).toHaveLength(20);
      expect(preview.body.data.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: rowCount,
        totalPages: 251,
        hasNext: true
      });
      expect(Buffer.byteLength(JSON.stringify(preview.body), 'utf8')).toBeLessThan(256 * 1024);
      const deepPreview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=${rowCount}&pageSize=1`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(deepPreview.body.data.rows).toHaveLength(1);
      expect(deepPreview.body.data.rows[0].rowNumber).toBe(rowCount + 1);

      const key = `b8-confirm-${suffix}-${rowCount}`;
      const approval = await loadImportApproval(taskId, financeToken);
      expect(approval.task.validation?.snapshot).toMatchObject({
        valid: true,
        counts: { total: rowCount, recordCount: rowCount, blockingErrorCount: 0 }
      });
      const startedAt = Date.now();
      const queued = await confirmRequest(taskId, approval.payload, key).expect(201);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(queued.body.data).toMatchObject({
        task: { id: taskId, status: 'confirming' },
        alreadyConfirmed: false
      });

      const finished = await waitForTerminalStatus(taskId) as unknown as {
        status: ImportTaskStatus;
        importedRows: number;
        errorRows: number;
      };
      expect(finished).toMatchObject({ status: ImportTaskStatus.confirmed, importedRows: rowCount });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(rowCount);
      expect(await prisma.recordValue.count({ where: { record: { importTaskId: taskId } } })).toBe(rowCount * 2);
      const amount = await prisma.businessRecord.aggregate({
        where: { importTaskId: taskId, status: BusinessRecordStatus.confirmed },
        _sum: { amount: true }
      });
      expect(amount._sum.amount?.toFixed(2)).toBe('6151.23');
      const uniqueSources = await prisma.$queryRaw<Array<{ total: bigint; distinctSources: bigint }>>`
        SELECT COUNT(*)::bigint AS total, COUNT(DISTINCT source_id)::bigint AS "distinctSources"
        FROM business_records
        WHERE import_task_id = ${taskId}
      `;
      expect(uniqueSources[0]).toEqual({ total: BigInt(rowCount), distinctSources: BigInt(rowCount) });
      expect(await prisma.auditLog.count({
        where: { resourceId: taskId, action: 'import_task.confirm_completed' }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: taskId, eventType: 'import_task_confirmed' }
      })).toBe(1);
      const report = await request(app.getHttpServer())
        .get(`/api/reports/projects/${projectId}/daily?date=2026-07-15`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(report.body.data).toMatchObject({ expense: '6151.23', recordCount: rowCount });

      const replay = await confirmRequest(taskId, approval.payload, key).expect(201);
      expect(replay.body).toEqual(queued.body);
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(rowCount);
    });

    it('keeps a 50,000-row deep preview within response, latency, and memory budgets', async () => {
      const rowCount = 50_000;
      const taskId = await createTask(rowCount);
      const rssBefore = process.memoryUsage().rss;
      const startedAt = Date.now();
      const preview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=500&pageSize=100`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      const elapsedMs = Date.now() - startedAt;
      const rssDelta = Math.max(0, process.memoryUsage().rss - rssBefore);

      expect(preview.body.data.rows).toHaveLength(100);
      expect(preview.body.data.rows[0].rowNumber).toBe(49_902);
      expect(preview.body.data.rows[99].rowNumber).toBe(50_001);
      expect(preview.body.data.pagination).toEqual({
        page: 500,
        pageSize: 100,
        total: rowCount,
        totalPages: 500,
        hasNext: false
      });
      expect(Buffer.byteLength(JSON.stringify(preview.body), 'utf8')).toBeLessThan(1024 * 1024);
      expect(elapsedMs).toBeLessThan(20_000);
      expect(rssDelta).toBeLessThan(256 * 1024 * 1024);

      const cachedStartedAt = Date.now();
      const cached = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview?page=1&pageSize=1`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(cached.body.data.rows).toHaveLength(1);
      expect(Date.now() - cachedStartedAt).toBeLessThan(2_000);
    }, 120_000);

    it.each([
      [30_196, '2026-07-16'],
      [49_999, '2026-07-17']
    ])('confirms %i rows with bounded worker resources and a complete accounting closure', async (rowCount, recordDate) => {
      const taskId = await createTask(rowCount, recordDate);
      const validationStartedAt = Date.now();
      const approval = await loadImportApproval(taskId, financeToken);
      const validationElapsedMs = Date.now() - validationStartedAt;
      expect(approval.task.validation?.snapshot).toMatchObject({
        valid: true,
        counts: { total: rowCount, recordCount: rowCount, blockingErrorCount: 0 }
      });
      const baselineRss = process.memoryUsage().rss;
      let peakRss = baselineRss;
      let peakConnections = 0;
      let sampling = true;
      const sampleResources = async () => {
        while (sampling) {
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
          const [connectionSample] = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*)::bigint AS count
            FROM pg_stat_activity
            WHERE datname = current_database()
          `;
          peakConnections = Math.max(peakConnections, Number(connectionSample.count));
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      };
      const samplingPromise = sampleResources();
      const startedAt = Date.now();
      let apiLatencyMs = 0;
      let elapsedMs = 0;
      let finished: Awaited<ReturnType<typeof waitForTerminalStatus>> | undefined;
      try {
        const queued = await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-${rowCount}`
        ).expect(201);
        apiLatencyMs = Date.now() - startedAt;
        expect(apiLatencyMs).toBeLessThan(2_000);
        expect(queued.body.data.task.status).toBe(ImportTaskStatus.confirming);
        finished = await waitForTerminalStatus(taskId, 180_000);
        elapsedMs = Date.now() - startedAt;
      } finally {
        sampling = false;
        await samplingPromise;
      }
      if (!finished) throw new Error(`Import confirmation ${taskId} did not produce a terminal result`);
      console.info('[B8-03 confirmation profile]', JSON.stringify({
        rowCount,
        validationElapsedMs,
        apiLatencyMs,
        elapsedMs,
        peakRssDeltaMb: Number(((peakRss - baselineRss) / 1024 / 1024).toFixed(2)),
        peakConnections,
        errorMessage: finished.errorMessage
      }));

      expect(finished).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: rowCount,
        confirmationProcessedRows: rowCount,
        confirmationSuccessRows: rowCount,
        confirmationErrorRows: 0
      });
      const [importRows, records, values, sourceFacts, statusFacts, amount] = await Promise.all([
        prisma.importRow.count({ where: { importTaskId: taskId } }),
        prisma.businessRecord.count({ where: { importTaskId: taskId } }),
        prisma.recordValue.count({ where: { record: { importTaskId: taskId } } }),
        prisma.$queryRaw<Array<{ total: bigint; distinctSources: bigint; unmatchedSources: bigint }>>`
          SELECT
            COUNT(record.id)::bigint AS total,
            COUNT(DISTINCT record.source_id)::bigint AS "distinctSources",
            COUNT(*) FILTER (WHERE row.id IS NULL)::bigint AS "unmatchedSources"
          FROM business_records AS record
          LEFT JOIN import_rows AS row
            ON row.id = record.source_id AND row.import_task_id = record.import_task_id
          WHERE record.import_task_id = ${taskId}
        `,
        prisma.businessRecord.groupBy({ where: { importTaskId: taskId }, by: ['status'], _count: true }),
        prisma.businessRecord.aggregate({ where: { importTaskId: taskId }, _sum: { amount: true } })
      ]);
      expect(importRows).toBe(rowCount);
      expect(records).toBe(rowCount);
      expect(values).toBe(rowCount * 2);
      expect(sourceFacts[0]).toEqual({
        total: BigInt(rowCount),
        distinctSources: BigInt(rowCount),
        unmatchedSources: 0n
      });
      expect(statusFacts).toEqual([{ status: BusinessRecordStatus.confirmed, _count: rowCount }]);
      expect(amount._sum.amount?.toFixed(2)).toBe(new Prisma.Decimal(rowCount).mul('1.23').toFixed(2));
      expect(await prisma.importRow.count({
        where: { importTaskId: taskId, status: ImportRowStatus.confirmed, generatedRecordId: { not: null } }
      })).toBe(rowCount);
      expect(await prisma.auditLog.count({
        where: { resourceId: taskId, action: 'import_task.confirm_completed' }
      })).toBe(1);
      const summaryEvent = await prisma.ledgerEvent.findFirstOrThrow({
        where: { aggregateId: taskId, eventType: 'import_task_confirmed' }
      });
      expect(summaryEvent.payload).toMatchObject({ importedRows: rowCount, totalRows: rowCount });
      expect(summaryEvent.payload).not.toHaveProperty('recordIds');
      const report = await request(app.getHttpServer())
        .get(`/api/reports/projects/${projectId}/daily?date=${recordDate}`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(report.body.data).toMatchObject({
        expense: new Prisma.Decimal(rowCount).mul('1.23').toFixed(2),
        recordCount: rowCount
      });
      expect(elapsedMs).toBeLessThan(180_000);
      expect(validationElapsedMs).toBeLessThan(180_000);
      expect(peakRss - baselineRss).toBeLessThan(1024 * 1024 * 1024);
      expect(peakConnections).toBeGreaterThan(0);
    }, 360_000);

    it('recovers an expired confirmation from persisted database facts', async () => {
      const rowCount = 1_200;
      const taskId = await createTask(rowCount, '2026-07-18');
      await queueWithoutRunningWorker(taskId, `b8-confirm-${suffix}-expired-recovery`);
      await prisma.importTask.update({
        where: { id: taskId },
        data: {
          leaseToken: 'expired-worker-token',
          leaseUntil: new Date(Date.now() - 1_000),
          confirmationAttempts: 1
        }
      });
      expect(await app.get(ImportTasksService).recoverExpiredConfirmations()).toBe(1);
      expect(await waitForTerminalStatus(taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: rowCount,
        confirmationAttempts: 2,
        confirmedBy: reviewerUserId
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(rowCount);
      expect(await prisma.auditLog.count({
        where: { resourceId: taskId, action: 'import_task.confirm_recovered' }
      })).toBe(1);
    });

    it('claims a normal API-to-worker confirmation handoff without consuming a retry', async () => {
      const rowCount = 100;
      const taskId = await createTask(rowCount, '2026-07-18');
      await queueWithoutRunningWorker(taskId, `b8-confirm-${suffix}-worker-handoff`);
      await prisma.importTask.update({
        where: { id: taskId },
        data: {
          leaseToken: 'worker-handoff:integration-confirm-token',
          leaseUntil: new Date(Date.now() - 1_000),
          confirmationAttempts: 1
        }
      });
      expect(await app.get(ImportTasksService).recoverExpiredConfirmations()).toBe(1);
      expect(await waitForTerminalStatus(taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: rowCount,
        confirmationAttempts: 1
      });
      expect(await prisma.auditLog.count({
        where: { resourceId: taskId, action: 'import_task.confirm_claimed' }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: taskId, eventType: 'import_task_confirmation_claimed' }
      })).toBe(1);
    });

    it('fails closed when the approving finance account is disabled before final publication', async () => {
      const rowCount = 100;
      const taskId = await createTask(rowCount, '2026-07-18');
      await queueWithoutRunningWorker(taskId, `b8-confirm-${suffix}-approver-disabled`);
      await prisma.importTask.update({
        where: { id: taskId },
        data: {
          leaseToken: 'worker-handoff:approver-disabled',
          leaseUntil: new Date(Date.now() - 1_000)
        }
      });
      await prisma.user.update({ where: { id: reviewerUserId }, data: { status: UserStatus.disabled } });
      try {
        expect(await app.get(ImportTasksService).recoverExpiredConfirmations()).toBe(1);
        expect(await waitForTerminalStatus(taskId)).toMatchObject({
          status: ImportTaskStatus.confirmation_failed,
          importedRows: 0,
          confirmedAt: null,
          confirmedBy: null
        });
      } finally {
        await prisma.user.update({ where: { id: reviewerUserId }, data: { status: UserStatus.active } });
      }
      expect(await prisma.businessRecord.count({
        where: { importTaskId: taskId, status: BusinessRecordStatus.confirmed }
      })).toBe(0);
      expect(await prisma.businessRecord.count({
        where: { importTaskId: taskId, status: BusinessRecordStatus.pending_confirm }
      })).toBe(rowCount);
      expect(await prisma.ledgerEvent.count({
        where: { aggregateId: taskId, eventType: 'import_task_confirmed' }
      })).toBe(0);
    });

    it('lets a recovered lease take over while the old worker can no longer commit', async () => {
      const rowCount = 5_001;
      const taskId = await createTask(rowCount, '2026-07-19');
      const approval = await loadImportApproval(taskId, financeToken);
      await confirmRequest(
        taskId,
        approval.payload,
        `b8-confirm-${suffix}-lease-takeover`
      ).expect(201);
      const beforeTakeover = await waitForConfirmationProgress(taskId, 1);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${taskId}, 9))`;
        await tx.importTask.update({
          where: { id: taskId },
          data: { leaseToken: 'superseded-worker-token', leaseUntil: new Date(Date.now() - 1_000) }
        });
      });
      expect(await app.get(ImportTasksService).recoverExpiredConfirmations()).toBe(1);
      const finished = await waitForTerminalStatus(taskId);
      expect(finished).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: rowCount,
        confirmationAttempts: 2
      });
      expect(finished.confirmationProcessedRows).toBe(rowCount);
      expect(beforeTakeover.confirmationProcessedRows).toBeGreaterThan(0);
      const sourceFacts = await prisma.$queryRaw<Array<{ total: bigint; distinctSources: bigint }>>`
        SELECT COUNT(*)::bigint AS total, COUNT(DISTINCT source_id)::bigint AS "distinctSources"
        FROM business_records
        WHERE import_task_id = ${taskId}
      `;
      expect(sourceFacts[0]).toEqual({ total: BigInt(rowCount), distinctSources: BigInt(rowCount) });
      expect(await prisma.auditLog.count({
        where: { resourceId: taskId, action: 'import_task.confirm_recovered' }
      })).toBe(1);
    });

    it('keeps completed batches unpublished when the last batch fails and resumes without duplicates', async () => {
      const rowCount = 1_001;
      const taskId = await createTask(rowCount, '2026-07-20');
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        processConfirmationBatch(job: { taskId: string }): Promise<boolean>;
      };
      const original = service.processConfirmationBatch.bind(service);
      const failure = jest.spyOn(service, 'processConfirmationBatch').mockImplementation(async (job) => {
        if (job.taskId === taskId) {
          const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
          if (task.confirmationProcessedRows >= 1_000) throw new Error('simulated final confirmation batch failure');
        }
        return original(job);
      });
      try {
        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-batch-failure-first`
        ).expect(201);
        expect(await waitForTerminalStatus(taskId)).toMatchObject({
          status: ImportTaskStatus.confirmation_failed,
          confirmationProcessedRows: 1_000,
          confirmationSuccessRows: 1_000
        });
      } finally {
        failure.mockRestore();
      }
      expect(await prisma.businessRecord.count({
        where: { importTaskId: taskId, status: BusinessRecordStatus.pending_confirm }
      })).toBe(1_000);
      const unpublishedReport = await request(app.getHttpServer())
        .get(`/api/reports/projects/${projectId}/daily?date=2026-07-20`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(unpublishedReport.body.data).toMatchObject({ expense: '0.00', recordCount: 0 });
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/cancel`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(409);

      const retryApproval = await loadImportApproval(taskId, financeToken, false);
      await confirmRequest(
        taskId,
        retryApproval.payload,
        `b8-confirm-${suffix}-batch-failure-retry`
      ).expect(201);
      expect(await waitForTerminalStatus(taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: rowCount,
        confirmationAttempts: 2
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(rowCount);
      expect(await prisma.recordValue.count({ where: { record: { importTaskId: taskId } } })).toBe(rowCount * 2);
      const publishedReport = await request(app.getHttpServer())
        .get(`/api/reports/projects/${projectId}/daily?date=2026-07-20`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(publishedReport.body.data).toMatchObject({ expense: '1231.23', recordCount: rowCount });
    });

    it.each([
      { code: 'P1001', label: 'short PostgreSQL disconnect' },
      { code: 'P2028', label: 'Prisma transaction timeout' },
      { code: 'P2034', label: 'transaction write conflict' }
    ])('recovers after a simulated $label', async ({ code }) => {
      const rowCount = 1_001;
      const taskId = await createTask(rowCount, '2026-07-21');
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        processConfirmationBatch(job: { taskId: string }): Promise<boolean>;
      };
      const original = service.processConfirmationBatch.bind(service);
      let failedOnce = false;
      const failure = jest.spyOn(service, 'processConfirmationBatch').mockImplementation(async (job) => {
        if (job.taskId === taskId && !failedOnce) {
          failedOnce = true;
          throw new Prisma.PrismaClientKnownRequestError(`simulated transient database error ${code}`, {
            code,
            clientVersion: '6.19.3'
          });
        }
        return original(job);
      });
      try {
        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-database-${code.toLowerCase()}`
        ).expect(201);
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
          if (task.status === ImportTaskStatus.confirming && task.leaseUntil && task.leaseUntil < new Date()) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        failure.mockRestore();
      }
      expect(await app.get(ImportTasksService).recoverExpiredConfirmations()).toBe(1);
      expect(await waitForTerminalStatus(taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: rowCount,
        confirmationAttempts: 2
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(rowCount);
    });

    it('keeps a slow but bounded staging batch inside one confirmation attempt', async () => {
      const taskId = await createTask(101, '2026-07-21');
      const approval = await loadImportApproval(taskId, financeToken);
      const dropDelay = async () => {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS "integration_delay_one_staging_batch" ON "business_records"'
        );
        await prisma.$executeRawUnsafe(
          'DROP FUNCTION IF EXISTS "integration_delay_one_staging_batch"()'
        );
        await prisma.$executeRawUnsafe(
          'DROP TABLE IF EXISTS "integration_staging_delay"'
        );
        await prisma.$executeRawUnsafe(
          'DROP SEQUENCE IF EXISTS "integration_staging_delay_sequence"'
        );
      };

      await dropDelay();
      await prisma.$executeRawUnsafe(
        'CREATE TABLE "integration_staging_delay" ("task_id" TEXT PRIMARY KEY)'
      );
      await prisma.$executeRaw`
        INSERT INTO "integration_staging_delay" ("task_id") VALUES (${taskId})
      `;
      await prisma.$executeRawUnsafe(
        'CREATE SEQUENCE "integration_staging_delay_sequence" START 1'
      );
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "integration_delay_one_staging_batch"() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "integration_staging_delay" AS delay
            WHERE delay."task_id" = NEW."import_task_id"
          ) AND nextval('"integration_staging_delay_sequence"') = 1
          THEN
            PERFORM pg_sleep(6);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "integration_delay_one_staging_batch"
        BEFORE INSERT ON "business_records"
        FOR EACH ROW EXECUTE FUNCTION "integration_delay_one_staging_batch"()
      `);

      try {
        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-slow-staging-batch`
        ).expect(201);
        expect(await waitForTerminalStatus(taskId, 30_000)).toMatchObject({
          status: ImportTaskStatus.confirmed,
          importedRows: 101,
          confirmationAttempts: 1
        });
      } finally {
        await dropDelay();
      }
    }, 45_000);

    it('precomputes integrity outside the publication transaction and recovers a finalization timeout', async () => {
      const rowCount = 1_001;
      const taskId = await createTask(rowCount, '2026-07-22');
      const approval = await loadImportApproval(taskId, financeToken);
      const service = app.get(ImportTasksService) as unknown as {
        recomputeApprovalIntegrity(
          writer: unknown,
          task: unknown,
          heartbeat?: () => Promise<void>
        ): Promise<{ rowSetHash: string; normalizedOutputHash: string; recordCount: number }>;
        completeBackgroundConfirmation(job: { taskId: string }, integrity: unknown): Promise<void>;
      };
      const originalIntegrity = service.recomputeApprovalIntegrity.bind(service);
      const integrityWriters: unknown[] = [];
      const integritySpy = jest.spyOn(service, 'recomputeApprovalIntegrity').mockImplementation(
        async (writer, task, heartbeat) => {
          integrityWriters.push(writer);
          return originalIntegrity(writer, task, heartbeat);
        }
      );
      const originalCompletion = service.completeBackgroundConfirmation.bind(service);
      let failedOnce = false;
      const completionFailure = jest.spyOn(service, 'completeBackgroundConfirmation').mockImplementation(
        async (job, integrity) => {
          if (job.taskId === taskId && !failedOnce) {
            failedOnce = true;
            throw new Prisma.PrismaClientKnownRequestError('simulated final publication timeout', {
              code: 'P2028',
              clientVersion: '6.19.3'
            });
          }
          return originalCompletion(job, integrity);
        }
      );

      try {
        await confirmRequest(
          taskId,
          approval.payload,
          `b8-confirm-${suffix}-publication-timeout`
        ).expect(201);
        const deadline = Date.now() + 10_000;
        let releasedForRecovery = false;
        while (Date.now() < deadline) {
          const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
          if (
            task.status === ImportTaskStatus.confirming
            && task.leaseUntil
            && task.leaseUntil < new Date()
          ) {
            releasedForRecovery = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(releasedForRecovery).toBe(true);
        completionFailure.mockRestore();

        expect(await app.get(ImportTasksService).recoverExpiredConfirmations()).toBe(1);
        expect(await waitForTerminalStatus(taskId)).toMatchObject({
          status: ImportTaskStatus.confirmed,
          importedRows: rowCount,
          confirmationAttempts: 2
        });
        expect(integrityWriters.length).toBeGreaterThanOrEqual(2);
        expect(integrityWriters.every((writer) => writer === prisma)).toBe(true);
        expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(rowCount);
        expect(await prisma.ledgerEvent.count({
          where: { aggregateId: taskId, eventType: 'business_records_batch_committed' }
        })).toBe(1);
      } finally {
        completionFailure.mockRestore();
        integritySpy.mockRestore();
      }
    });

    it('serializes concurrent confirmation requests into one background job', async () => {
      const rowCount = 1_001;
      const taskId = await createTask(rowCount, '2026-07-22');
      const approval = await loadImportApproval(taskId, financeToken);
      const [first, second] = await Promise.all([
        confirmRequest(taskId, approval.payload, `b8-confirm-${suffix}-concurrent-a`),
        confirmRequest(taskId, approval.payload, `b8-confirm-${suffix}-concurrent-b`)
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const accepted = first.status === 201 ? first : second;
      const rejected = first.status === 409 ? first : second;
      expect(accepted.body.data.task.status).toBe(ImportTaskStatus.confirming);
      expect(rejected.body.data.reason).toBe('IMPORT_APPROVAL_CONCURRENT_CONFLICT');
      expect(await waitForTerminalStatus(taskId)).toMatchObject({
        status: ImportTaskStatus.confirmed,
        importedRows: rowCount,
        confirmationAttempts: 1
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(rowCount);
      expect(await prisma.auditLog.count({
        where: { resourceId: taskId, action: 'import_task.confirm_scheduled' }
      })).toBe(1);
    });
  });

  it('keeps legacy XLS evidence intact while importing only a sanitized in-memory workbook', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const enabled = await prisma.projectTemplate.findFirstOrThrow({
      where: { isActive: true, project: { status: ProjectStatus.active } }
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['日期', '金额'],
      ['2026-07-01', 120],
      ['2026-07-02', 230]
    ]), 'Data');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['归档标记'],
      ['internal']
    ]), 'Archive');
    workbook.Workbook = {
      Sheets: [{ name: 'Data', Hidden: 0 }, { name: 'Archive', Hidden: 1 }]
    };
    const xls = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    const expectedHash = createHash('sha256').update(xls).digest('hex');
    const key = `integration-legacy-xls-${Date.now()}`;
    let taskId: string | undefined;
    let rawFileId: string | undefined;

    try {
      const created = await request(app.getHttpServer())
        .post('/api/import-tasks')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .field('projectId', enabled.projectId)
        .field('templateId', enabled.templateId)
        .field('importType', enabled.recordType)
        .attach('file', xls, { filename: 'synthetic-legacy.xls', contentType: 'application/vnd.ms-excel' })
        .expect(201);
      taskId = created.body.data.id as string;
      rawFileId = created.body.data.rawFileId as string;

      const rawFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: rawFileId } });
      expect(rawFile).toMatchObject({
        originalFileName: 'synthetic-legacy.xls',
        mimeType: 'application/vnd.ms-excel',
        fileType: 'excel',
        sha256: expectedHash,
        fileSize: BigInt(xls.length),
        status: RawFileStatus.uploaded
      });
      expect(Buffer.compare(
        Buffer.from(await fileStorage.read(rawFile.storagePath)),
        Buffer.from(xls)
      )).toBe(0);

      const inspected = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/inspect`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(inspected.body.data).toMatchObject({
        requiresSheetSelection: true,
        sheets: [
          { sheetIndex: 0, sheetName: 'Data', state: 'visible' },
          { sheetIndex: 1, sheetName: 'Archive', state: 'hidden' }
        ]
      });

      const parsed = await request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/parse`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sheetIndex: 0, headerStartRowIndex: 1, headerRowIndex: 1 })
        .expect(201);
      expect(parsed.body.data).toMatchObject({
        counts: { total: 2, valid: 2, errors: 0, duplicates: 0, ignored: 0, imported: 0 }
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: taskId } })).toBe(0);

      const [createAudit, inspectAudit, parseAudit, createLedger, parseLedger] = await Promise.all([
        prisma.auditLog.findFirstOrThrow({ where: { action: 'import_task.create', resourceId: taskId } }),
        prisma.auditLog.findFirstOrThrow({ where: { action: 'import_task.inspect', resourceId: taskId } }),
        prisma.auditLog.findFirstOrThrow({ where: { action: 'import_task.parse', resourceId: taskId } }),
        prisma.ledgerEvent.findFirstOrThrow({ where: { eventType: 'import_task_created', aggregateId: taskId } }),
        prisma.ledgerEvent.findFirstOrThrow({ where: { eventType: 'import_task_parsed', aggregateId: taskId } })
      ]);
      for (const event of [createAudit.metadata, inspectAudit.metadata, parseAudit.metadata, createLedger.payload, parseLedger.payload]) {
        expect(event).toMatchObject({
          sourceFormat: 'xls',
          conversion: {
            sourceFormat: 'xls',
            outputFormat: 'xlsx',
            converter: 'sheetjs-sanitizer',
            converterVersion: '0.20.3',
            sheetCount: 2,
            hiddenSheetCount: 1
          }
        });
      }
    } finally {
      const rawFile = rawFileId
        ? await prisma.rawFile.findUnique({ where: { id: rawFileId }, select: { storagePath: true } })
        : undefined;
      if (taskId) {
        await prisma.businessRecord.deleteMany({ where: { importTaskId: taskId } });
        await prisma.importTask.deleteMany({ where: { id: taskId } });
      }
      if (rawFile) await fileStorage.remove(rawFile.storagePath);
      if (rawFileId) await prisma.rawFile.deleteMany({ where: { id: rawFileId } });
      const resourceIds = [taskId, rawFileId].filter((id): id is string => Boolean(id));
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
      await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
    }
  });

  it('persists, cancels, and recovers large background XLSX files without partial records', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    const enabled = await prisma.projectTemplate.findFirstOrThrow({
      where: {
        projectId: 'dp-001',
        templateId: 'dt-reimbursement',
        isActive: true,
        project: { status: ProjectStatus.active }
      },
      include: { project: true, template: true }
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Synthetic large import');
    sheet.addRow(['日期', '金额']);
    for (let index = 1; index <= 5001; index += 1) {
      sheet.addRow([
        `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
        index
      ]);
    }
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
    const taskIds: string[] = [];
    const rawFileIds: string[] = [];
    const parser = app.get(ExcelParserService);
    const imports = app.get(ImportTasksService);
    let releaseFirstBatch: () => void = () => undefined;
    let releaseRecoveryBatch: () => void = () => undefined;
    let parseSpy: jest.SpyInstance | undefined;

    const createTask = async (key: string, fileName: string, contents = xlsx) => {
      const response = await request(app.getHttpServer())
        .post('/api/import-tasks')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .field('projectId', enabled.projectId)
        .field('templateId', enabled.templateId)
        .field('importType', enabled.recordType)
        .attach('file', contents, {
          filename: fileName,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
        .expect(201);
      taskIds.push(response.body.data.id as string);
      rawFileIds.push(response.body.data.rawFileId as string);
      return response.body.data.id as string;
    };
    const waitForFinished = async (taskId: string) => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const task = await prisma.importTask.findUniqueOrThrow({ where: { id: taskId } });
        if (
          task.status === ImportTaskStatus.pending_confirm ||
          task.status === ImportTaskStatus.failed ||
          task.status === ImportTaskStatus.cancelled
        ) return task;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Background import did not finish in time');
    };

    try {
      const cancelledTaskId = await createTask(`integration-large-cancel-${Date.now()}`, 'synthetic-large-cancel.xlsx');
      let firstBatchPersisted!: () => void;
      const firstBatch = new Promise<void>((resolve) => { firstBatchPersisted = resolve; });
      const pause = new Promise<void>((resolve) => { releaseFirstBatch = resolve; });
      const originalParse = parser.parseInBatches.bind(parser);
      let paused = false;
      parseSpy = jest.spyOn(parser, 'parseInBatches').mockImplementation(async (buffer, onRows, options, settings) => (
        originalParse(buffer, async (rows, progress) => {
          await onRows(rows, progress);
          if (!paused) {
            paused = true;
            firstBatchPersisted();
            await pause;
          }
        }, options, settings)
      ));

      const scheduled = await request(app.getHttpServer())
        .post(`/api/import-tasks/${cancelledTaskId}/parse`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      expect(scheduled.body.data).toMatchObject({
        status: ImportTaskStatus.parsing,
        progress: { executionMode: 'background', total: 5001, attempts: 1 }
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('First import batch timed out')), 5000);
        firstBatch.then(() => {
          clearTimeout(timeout);
          resolve();
        }, reject);
      });
      const inProgress = await request(app.getHttpServer())
        .get(`/api/import-tasks/${cancelledTaskId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(inProgress.body.data.progress).toMatchObject({ processed: 500, total: 5001, percent: 10 });
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${cancelledTaskId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
        .expect(({ body }) => expect(body.data).toMatchObject({
          status: ImportTaskStatus.cancelled,
          progress: { processed: 0, total: 5001 }
        }));
      releaseFirstBatch();
      parseSpy.mockRestore();
      parseSpy = undefined;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await prisma.importRow.count({ where: { importTaskId: cancelledTaskId } })).toBe(0);
      expect(await prisma.importSheet.count({ where: { importTaskId: cancelledTaskId } })).toBe(0);
      expect(await prisma.businessRecord.count({ where: { importTaskId: cancelledTaskId } })).toBe(0);

      const handoffTaskId = await createTask(`integration-large-handoff-${Date.now()}`, 'synthetic-large-handoff.xlsx');
      await prisma.importTask.update({
        where: { id: handoffTaskId },
        data: {
          status: ImportTaskStatus.parsing,
          executionMode: 'background',
          processingMode: 'streaming',
          parseConfig: {},
          parseAttempts: 1,
          totalRows: 5001,
          leaseToken: 'worker-handoff:integration-parse-token',
          leaseUntil: new Date(Date.now() - 1_000)
        }
      });
      expect(await imports.recoverExpiredParses()).toBe(1);
      expect(await waitForFinished(handoffTaskId)).toMatchObject({
        status: ImportTaskStatus.pending_confirm,
        totalRows: 5001,
        parseAttempts: 1
      });
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.parse_claimed', resourceId: handoffTaskId }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_parse_claimed', aggregateId: handoffTaskId }
      })).toBe(1);

      const recoveredTaskId = await createTask(`integration-large-recover-${Date.now()}`, 'synthetic-large-recover.xlsx');
      let recoveryBatchPersisted!: () => void;
      const recoveryBatch = new Promise<void>((resolve) => { recoveryBatchPersisted = resolve; });
      const recoveryPause = new Promise<void>((resolve) => { releaseRecoveryBatch = resolve; });
      const recoveryOriginalParse = parser.parseInBatches.bind(parser);
      let recoveryPaused = false;
      parseSpy = jest.spyOn(parser, 'parseInBatches').mockImplementation(async (buffer, onRows, options, settings) => (
        recoveryOriginalParse(buffer, async (rows, progress) => {
          await onRows(rows, progress);
          if (!recoveryPaused) {
            recoveryPaused = true;
            recoveryBatchPersisted();
            await recoveryPause;
          }
        }, options, settings)
      ));
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${recoveredTaskId}/parse`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Recovery import batch timed out')), 5000);
        recoveryBatch.then(() => {
          clearTimeout(timeout);
          resolve();
        }, reject);
      });
      expect(await prisma.importRow.count({ where: { importTaskId: recoveredTaskId } })).toBe(500);
      await prisma.importTask.update({
        where: { id: recoveredTaskId },
        data: {
          leaseUntil: new Date(Date.now() - 60_000)
        }
      });
      await imports.recoverExpiredParses();
      const recovered = await waitForFinished(recoveredTaskId);
      releaseRecoveryBatch();
      parseSpy.mockRestore();
      parseSpy = undefined;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(recovered.status).toBe(ImportTaskStatus.pending_confirm);
      expect(recovered).toMatchObject({
        totalRows: 5001,
        processedRows: 5001,
        validRows: 5001,
        parseAttempts: 2,
        leaseToken: null,
        leaseUntil: null
      });
      const rows = await prisma.importRow.findMany({
        where: { importTaskId: recoveredTaskId },
        select: { rowNumber: true, rowHash: true },
        orderBy: { rowNumber: 'asc' }
      });
      expect(rows).toHaveLength(5001);
      expect(rows[0].rowNumber).toBe(2);
      expect(rows.at(-1)?.rowNumber).toBe(5002);
      expect(new Set(rows.map((row) => row.rowNumber)).size).toBe(5001);
      expect(new Set(rows.map((row) => row.rowHash)).size).toBe(5001);
      expect(await prisma.businessRecord.count({ where: { importTaskId: recoveredTaskId } })).toBe(0);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.parse_recovered', resourceId: recoveredTaskId }
      })).toBe(1);
      expect(await prisma.ledgerEvent.count({
        where: { eventType: 'import_task_parsed', aggregateId: recoveredTaskId }
      })).toBe(1);

      const productionScaleWorkbook = new ExcelJS.Workbook();
      const productionScaleSheet = productionScaleWorkbook.addWorksheet('Synthetic production scale');
      productionScaleSheet.addRow(['日期', '金额']);
      for (let index = 1; index <= 30196; index += 1) {
        productionScaleSheet.addRow([
          `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
          index
        ]);
      }
      const productionScaleBuffer = Buffer.from(await productionScaleWorkbook.xlsx.writeBuffer());
      const productionScaleTaskId = await createTask(
        `integration-large-30196-${Date.now()}`,
        'synthetic-production-scale.xlsx',
        productionScaleBuffer
      );
      await request(app.getHttpServer())
        .post(`/api/import-tasks/${productionScaleTaskId}/parse`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201)
        .expect(({ body }) => expect(body.data).toMatchObject({
          status: ImportTaskStatus.parsing,
          progress: { executionMode: 'background', total: 30196 }
        }));
      const productionScaleResult = await waitForFinished(productionScaleTaskId);
      expect(productionScaleResult.status).toBe(ImportTaskStatus.pending_confirm);
      expect(productionScaleResult).toMatchObject({
        totalRows: 30196,
        processedRows: 30196,
        validRows: 30196,
        parseAttempts: 1
      });
      const [stats] = await prisma.$queryRaw<Array<{
        total: bigint;
        distinctRows: bigint;
        distinctHashes: bigint;
        firstRow: number;
        lastRow: number;
      }>>`
        SELECT
          COUNT(*)::bigint AS "total",
          COUNT(DISTINCT "row_number")::bigint AS "distinctRows",
          COUNT(DISTINCT "row_hash")::bigint AS "distinctHashes",
          MIN("row_number") AS "firstRow",
          MAX("row_number") AS "lastRow"
        FROM "import_rows"
        WHERE "import_task_id" = ${productionScaleTaskId}
      `;
      expect(stats).toEqual({
        total: 30196n,
        distinctRows: 30196n,
        distinctHashes: 30196n,
        firstRow: 2,
        lastRow: 30197
      });
      expect(await prisma.businessRecord.count({ where: { importTaskId: productionScaleTaskId } })).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await prisma.importTask.update({
        where: { id: productionScaleTaskId },
        data: {
          status: ImportTaskStatus.parsing,
          executionMode: 'background',
          parseConfig: {},
          parseAttempts: 3,
          leaseToken: 'exhausted-integration-lease',
          leaseUntil: new Date(Date.now() - 60_000),
          processedRows: 30196
        }
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await imports.recoverExpiredParses();
        const exhausted = await prisma.importTask.findUniqueOrThrow({ where: { id: productionScaleTaskId } });
        if (exhausted.status === ImportTaskStatus.failed) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const exhausted = await prisma.importTask.findUniqueOrThrow({ where: { id: productionScaleTaskId } });
      expect(exhausted).toMatchObject({
        status: ImportTaskStatus.failed,
        processedRows: 0,
        parseAttempts: 3,
        leaseToken: null,
        leaseUntil: null
      });
      expect(await prisma.importRow.count({ where: { importTaskId: productionScaleTaskId } })).toBe(0);
      expect(await prisma.auditLog.count({
        where: { action: 'import_task.parse_recovery_exhausted', resourceId: productionScaleTaskId }
      })).toBe(1);
    } finally {
      releaseFirstBatch();
      releaseRecoveryBatch();
      parseSpy?.mockRestore();
      const files = rawFileIds.length
        ? await prisma.rawFile.findMany({ where: { id: { in: rawFileIds } }, select: { id: true, storagePath: true } })
        : [];
      if (taskIds.length) {
        await prisma.businessRecord.deleteMany({ where: { importTaskId: { in: taskIds } } });
        await prisma.importTask.deleteMany({ where: { id: { in: taskIds } } });
      }
      for (const file of files) await fileStorage.remove(file.storagePath);
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      const resourceIds = [...taskIds, ...rawFileIds];
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
      await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
    }
  });

  it('runs OCR through human correction, idempotent confirmation, and recoverable retry', async () => {
    const usernames = ['employee', 'finance', 'boss'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<string, string>;
    const suffix = Date.now().toString(36);
    const alternateFinance = await prisma.user.findFirstOrThrow({
      where: { username: { not: 'finance' }, role: UserRole.finance, status: UserStatus.active },
      orderBy: { createdAt: 'asc' }
    });
    const alternateFinanceLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: alternateFinance.username, password: '123456' })
      .expect(200);
    tokens.financeApprover = alternateFinanceLogin.body.data.accessToken as string;
    const secondApprover = await prisma.user.create({
      data: {
        username: `${TEST_USER_PREFIX}ocr_approver_${suffix}`,
        passwordHash: await bcrypt.hash('123456', 10),
        name: 'Synthetic OCR second approver',
        role: UserRole.finance,
        status: UserStatus.active,
        department: 'Synthetic finance'
      }
    });
    const secondApproverLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: secondApprover.username, password: '123456' })
      .expect(200);
    tokens.financeApprover2 = secondApproverLogin.body.data.accessToken as string;
    const taskIds: string[] = [];
    const recordIds: string[] = [];
    const rawFileIds: string[] = [];
    const storagePaths: string[] = [];

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([420, 595]);
    page.drawText('Synthetic OCR receipt', { x: 40, y: 540, size: 16 });
    page.drawText('Amount: 1280.50', { x: 40, y: 500, size: 12 });
    const pdfBuffer = Buffer.from(await pdf.save());

    try {
      const longPdf = await PDFDocument.create();
      for (let pageNo = 1; pageNo <= 21; pageNo += 1) {
        const longPage = longPdf.addPage([420, 595]);
        longPage.drawText(`Synthetic OCR page ${pageNo}`, { x: 40, y: 540, size: 16 });
      }
      const longPdfBuffer = Buffer.from(await longPdf.save());
      const rejectedName = `OCR-page-range-required-${suffix}.pdf`;
      await request(app.getHttpServer())
        .post('/api/ocr-tasks/upload')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .field('projectId', 'dp-001')
        .field('templateId', 'dt-reimbursement')
        .attach('file', longPdfBuffer, { filename: rejectedName, contentType: 'application/pdf' })
        .expect(400);
      const rejectedFile = await prisma.rawFile.findFirstOrThrow({
        where: { originalFileName: rejectedName },
        orderBy: { uploadedAt: 'desc' }
      });
      rawFileIds.push(rejectedFile.id);
      expect(rejectedFile).toMatchObject({ isVoided: true, status: RawFileStatus.voided });
      await expect(fileStorage.read(rejectedFile.storagePath)).rejects.toMatchObject({ code: 'ENOENT' });

      const rangedCreated = await request(app.getHttpServer())
        .post('/api/ocr-tasks/upload')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', `integration-ocr-${suffix}-range`)
        .field('projectId', 'dp-001')
        .field('templateId', 'dt-reimbursement')
        .field('pageStart', '16')
        .field('pageEnd', '21')
        .attach('file', longPdfBuffer, { filename: `OCR-page-range-${suffix}.pdf`, contentType: 'application/pdf' })
        .expect(201);
      const rangedTaskId = rangedCreated.body.data.id as string;
      const rangedRawFileId = rangedCreated.body.data.rawFileId as string;
      taskIds.push(rangedTaskId);
      rawFileIds.push(rangedRawFileId);
      const rangedRawFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: rangedRawFileId } });
      storagePaths.push(rangedRawFile.storagePath);
      expect(rangedCreated.body.data).toMatchObject({
        status: OcrTaskStatus.uploaded,
        pageCount: 6,
        pages: [
          expect.objectContaining({ page: 16 }),
          expect.objectContaining({ page: 17 }),
          expect.objectContaining({ page: 18 }),
          expect.objectContaining({ page: 19 }),
          expect.objectContaining({ page: 20 }),
          expect.objectContaining({ page: 21 })
        ]
      });
      expect(await prisma.ocrTask.findUniqueOrThrow({ where: { id: rangedTaskId } })).toMatchObject({
        providerOptions: { pageRange: { pageStart: 16, pageEnd: 21 } }
      });
      const rangedQueued = await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${rangedTaskId}/run`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);
      expect(rangedQueued.body.data).toMatchObject({ status: OcrTaskStatus.queued, attemptCount: 0 });
      await waitForOcrStatus(rangedTaskId, [OcrTaskStatus.pending_confirm]);
      const rangedRecognized = await request(app.getHttpServer())
        .get(`/api/ocr-tasks/${rangedTaskId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(rangedRecognized.body.data).toMatchObject({
        status: OcrTaskStatus.pending_confirm,
        textBlocks: [expect.objectContaining({ page: 16 })],
        fields: expect.arrayContaining([expect.objectContaining({ page: 16 })])
      });
      expect(await prisma.businessRecord.count({
        where: { sourceType: RecordSourceType.ocr, sourceId: rangedTaskId }
      })).toBe(0);
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${rangedTaskId}/cancel`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);

      const uploaded = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-ocr-upload-${suffix}`)
        .field('relatedProjectId', 'dp-001')
        .attach('file', pdfBuffer, { filename: 'OCR合成票据.pdf', contentType: 'application/pdf' })
        .expect(201);
      const rawFileId = uploaded.body.data.id as string;
      rawFileIds.push(rawFileId);
      const storedFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: rawFileId } });
      storagePaths.push(storedFile.storagePath);

      const createPayload = {
        rawFileId,
        projectId: 'dp-001',
        templateId: 'dt-reimbursement',
        mockScenario: 'low_confidence'
      };
      await request(app.getHttpServer())
        .post('/api/ocr-tasks')
        .set('Authorization', `Bearer ${tokens.employee}`)
        .send(createPayload)
        .expect(403);

      const created = await request(app.getHttpServer())
        .post('/api/ocr-tasks')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', `integration-ocr-${suffix}-low`)
        .send(createPayload)
        .expect(201);
      const taskId = created.body.data.id as string;
      taskIds.push(taskId);
      expect(created.body.data).toMatchObject({
        status: OcrTaskStatus.uploaded,
        provider: 'mock',
        pageCount: 1,
        rawFile: { id: rawFileId, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
      });

      const repeatedCreate = await request(app.getHttpServer())
        .post('/api/ocr-tasks')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', `integration-ocr-${suffix}-low`)
        .send(createPayload)
        .expect(201);
      expect(repeatedCreate.body).toEqual(created.body);
      await request(app.getHttpServer())
        .post('/api/ocr-tasks')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', `integration-ocr-${suffix}-low`)
        .send({ ...createPayload, mockScenario: 'failure_once' })
        .expect(409);

      await request(app.getHttpServer())
        .get(`/api/ocr-tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/ocr-tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);

      const queued = await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/run`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-ocr-run-${suffix}`)
        .expect(201);
      expect(queued.body.data).toMatchObject({ status: OcrTaskStatus.queued, attemptCount: 0 });
      await waitForOcrStatus(taskId, [OcrTaskStatus.pending_confirm]);
      const recognized = await request(app.getHttpServer())
        .get(`/api/ocr-tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(recognized.body.data).toMatchObject({
        status: OcrTaskStatus.pending_confirm,
        version: expect.any(Number),
        reviewRevision: 0,
        validation: null,
        extractedText: expect.stringContaining('金额'),
        evidence: {
          schemaVersion: 'ocr-ir/1.0',
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          irHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          coordinateVersion: 'page-native-top-left-v1',
          preprocessingVersion: 'ocr-preprocess-v1'
        },
        textBlocks: [expect.objectContaining({ blockId: 'p1-b1', confidence: '0.94' })],
        attemptCount: 1,
        attempts: [expect.objectContaining({ status: OcrAttemptStatus.succeeded, attemptNo: 1 })]
      });
      const candidates = recognized.body.data.fields as Array<{
        fieldId: string;
        fieldName: string;
        rawValue: unknown;
        normalizedValue: unknown;
        confidence: number;
        lowConfidence: boolean;
        evidenceRefs: string[];
      }>;
      const lowField = candidates.find((candidate) => candidate.lowConfidence);
      const amountField = candidates.find((candidate) => candidate.fieldName === '金额');
      expect(lowField).toMatchObject({ confidence: 0.55, lowConfidence: true });
      expect(amountField).toBeTruthy();
      expect(candidates.every((candidate) => candidate.evidenceRefs.length > 0)).toBe(true);
      const originalRawValues = new Map(candidates.map((candidate) => [candidate.fieldId, candidate.rawValue]));
      const storedOcrIr = await prisma.ocrTask.findUniqueOrThrow({ where: { id: taskId } });
      expect(storedOcrIr).toMatchObject({
        sourceSha256: storedFile.sha256,
        irSchemaVersion: 'ocr-ir/1.0',
        irHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        coordinateVersion: 'page-native-top-left-v1',
        preprocessingVersion: 'ocr-preprocess-v1',
        normalizedIr: expect.objectContaining({
          schemaVersion: 'ocr-ir/1.0',
          sourceId: taskId,
          hash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      });
      expect(await prisma.businessRecord.count({ where: { sourceType: RecordSourceType.ocr, sourceId: taskId } })).toBe(0);

      const unvalidatedApprovalPayload = {
        expectedVersion: recognized.body.data.version,
        expectedReviewRevision: 0,
        expectedValidationSnapshotHash: '0'.repeat(64),
        expectedPayloadHash: '0'.repeat(64),
        acknowledgedWarningIds: []
      };
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send(unvalidatedApprovalPayload)
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.financeApprover}`)
        .set('Idempotency-Key', `integration-ocr-confirm-${suffix}`)
        .send(unvalidatedApprovalPayload)
        .expect(409);

      const initialValidation = await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/revalidate`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-ocr-revalidate-initial-${suffix}`)
        .send({
          expectedVersion: recognized.body.data.version,
          expectedReviewRevision: 0
        })
        .expect(201);
      expect(initialValidation.body.data).toMatchObject({
        reviewRevision: 0,
        validation: {
          reviewRevision: 0,
          ruleVersion: 'ocr-deterministic-validation/1.0',
          snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          snapshot: {
            schemaVersion: 'ocr-validation/1.0',
            reviewRevision: 0,
            valid: true,
            blockingErrors: [],
            warnings: [expect.objectContaining({ code: 'LOW_OCR_CONFIDENCE' })]
          }
        }
      });
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.financeApprover}`)
        .set('Idempotency-Key', `integration-ocr-warning-ack-${suffix}`)
        .send({
          expectedVersion: initialValidation.body.data.version,
          expectedReviewRevision: 0,
          expectedValidationSnapshotHash: initialValidation.body.data.validation.snapshotHash,
          expectedPayloadHash: initialValidation.body.data.validation.snapshot.candidatePayloadHash,
          acknowledgedWarningIds: []
        })
        .expect(409)
        .expect(({ body }) => expect(body.data).toMatchObject({
          reason: 'OCR_WARNING_ACKNOWLEDGEMENT_MISMATCH',
          requiredWarningIds: [expect.stringMatching(/^warning:[a-f0-9]{64}$/)]
        }));
      expect(await prisma.businessRecord.count({ where: { sourceType: RecordSourceType.ocr, sourceId: taskId } })).toBe(0);

      await request(app.getHttpServer())
        .put(`/api/ocr-tasks/${taskId}/corrections`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          corrections: [{
            fieldId: amountField!.fieldId,
            correctedValue: '1299.25',
            reason: '缺少服务器版本前提的纠错必须失败'
          }]
        })
        .expect(400);
      expect(await prisma.ocrCorrection.count({ where: { ocrTaskId: taskId } })).toBe(0);

      const corrected = await request(app.getHttpServer())
        .put(`/api/ocr-tasks/${taskId}/corrections`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-ocr-correct-${suffix}`)
        .send({
          expectedVersion: initialValidation.body.data.version,
          expectedReviewRevision: 0,
          corrections: [
            { fieldId: lowField!.fieldId, correctedValue: '2026-07-01', reason: '人工核对票据日期' },
            { fieldId: amountField!.fieldId, correctedValue: '1299.25', reason: '人工核对票据金额' }
          ]
        })
        .expect(200);
      expect(corrected.body.data).toMatchObject({
        reviewRevision: 1,
        validation: null,
        version: initialValidation.body.data.version + 1
      });
      expect(corrected.body.data.corrections).toEqual(expect.arrayContaining([
        expect.objectContaining({
          fieldId: lowField!.fieldId,
          beforeValue: expect.any(String),
          afterValue: '2026-07-01',
          reviewRevision: 1,
          overrideType: 'MANUAL_OVERRIDE',
          evidenceRefs: expect.any(Array)
        }),
        expect.objectContaining({
          fieldId: amountField!.fieldId,
          afterValue: '1299.25',
          reviewRevision: 1,
          overrideType: 'MANUAL_OVERRIDE'
        })
      ]));
      const correctedLowField = corrected.body.data.fields.find(
        (candidate: { fieldId: string }) => candidate.fieldId === lowField!.fieldId
      );
      const correctedAmountField = corrected.body.data.fields.find(
        (candidate: { fieldId: string }) => candidate.fieldId === amountField!.fieldId
      );
      expect(correctedLowField).toMatchObject({
        rawValue: originalRawValues.get(lowField!.fieldId),
        normalizedValue: '2026-07-01',
        valueSource: 'MANUAL_OVERRIDE'
      });
      expect(correctedAmountField).toMatchObject({
        rawValue: originalRawValues.get(amountField!.fieldId),
        normalizedValue: '1299.25',
        valueSource: 'MANUAL_OVERRIDE'
      });
      expect(await prisma.ocrCorrection.count({ where: { ocrTaskId: taskId } })).toBe(2);

      await request(app.getHttpServer())
        .put(`/api/ocr-tasks/${taskId}/corrections`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          expectedVersion: recognized.body.data.version,
          expectedReviewRevision: 0,
          corrections: [{
            fieldId: amountField!.fieldId,
            correctedValue: '1300.00',
            reason: 'stale browser correction must fail'
          }]
        })
        .expect(409);
      await request(app.getHttpServer())
        .put(`/api/ocr-tasks/${taskId}/corrections`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          expectedVersion: corrected.body.data.version,
          expectedReviewRevision: 1,
          corrections: [{
            fieldId: amountField!.fieldId,
            correctedValue: '1300.00',
            reason: 'invalid cross-source evidence must fail',
            evidenceRefs: ['p99-b1']
          }]
        })
        .expect(400);
      expect(await prisma.ocrCorrection.count({ where: { ocrTaskId: taskId } })).toBe(2);

      const finalValidation = await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/revalidate`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-ocr-revalidate-final-${suffix}`)
        .send({
          expectedVersion: corrected.body.data.version,
          expectedReviewRevision: 1
        })
        .expect(201);
      expect(finalValidation.body.data).toMatchObject({
        reviewRevision: 1,
        validation: {
          reviewRevision: 1,
          snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          snapshot: {
            candidatePayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            valid: true,
            blockingErrors: [],
            warnings: []
          }
        }
      });
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/revalidate`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          expectedVersion: corrected.body.data.version,
          expectedReviewRevision: 1
        })
        .expect(409);

      const approvalPayload = {
        expectedVersion: finalValidation.body.data.version,
        expectedReviewRevision: 1,
        expectedValidationSnapshotHash: finalValidation.body.data.validation.snapshotHash as string,
        expectedPayloadHash: finalValidation.body.data.validation.snapshot.candidatePayloadHash as string,
        acknowledgedWarningIds: (finalValidation.body.data.validation.snapshot.warnings as Array<{ issueId: string }>)
          .map((warning) => warning.issueId)
      };
      await prisma.rawFile.update({
        where: { id: rawFileId },
        data: { isVoided: true, status: RawFileStatus.voided, scanStatus: FileScanStatus.failed }
      });
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.financeApprover}`)
        .set('Idempotency-Key', `integration-ocr-voided-source-${suffix}`)
        .send(approvalPayload)
        .expect(409)
        .expect(({ body }) => expect(body.data).toMatchObject({ reason: 'OCR_SOURCE_SECURITY_STATE_CHANGED' }));
      await prisma.rawFile.update({
        where: { id: rawFileId },
        data: { isVoided: false, status: storedFile.status, scanStatus: storedFile.scanStatus }
      });
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', `integration-ocr-self-approval-${suffix}`)
        .send(approvalPayload)
        .expect(403)
        .expect(({ body }) => expect(body.data).toMatchObject({ reason: 'OCR_SELF_APPROVAL_FORBIDDEN' }));

      await prisma.user.update({ where: { id: alternateFinance.id }, data: { status: UserStatus.disabled } });
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.financeApprover}`)
        .set('Idempotency-Key', `integration-ocr-disabled-approver-${suffix}`)
        .send(approvalPayload)
        .expect(401);
      await prisma.user.update({ where: { id: alternateFinance.id }, data: { status: UserStatus.active } });
      await prisma.user.update({ where: { id: secondApprover.id }, data: { role: UserRole.reviewer } });
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.financeApprover2}`)
        .set('Idempotency-Key', `integration-ocr-revoked-role-${suffix}`)
        .send(approvalPayload)
        .expect(403);
      await prisma.user.update({ where: { id: secondApprover.id }, data: { role: UserRole.finance } });

      const confirm = (token: string, key: string) => request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send(approvalPayload);
      const approvalAttempts = await Promise.all([
        confirm(tokens.financeApprover, `integration-ocr-confirm-${suffix}-a`),
        confirm(tokens.financeApprover2, `integration-ocr-confirm-${suffix}-b`)
      ]);
      expect(approvalAttempts.map((response) => response.status).sort()).toEqual([201, 409]);
      const winnerIndex = approvalAttempts.findIndex((response) => response.status === 201);
      const firstConfirm = approvalAttempts[winnerIndex];
      const winningApprover = winnerIndex === 0 ? alternateFinance : secondApprover;
      const winningToken = winnerIndex === 0 ? tokens.financeApprover : tokens.financeApprover2;
      const winningKey = `integration-ocr-confirm-${suffix}-${winnerIndex === 0 ? 'a' : 'b'}`;
      const replay = await confirm(winningToken, winningKey).expect(201);
      expect(replay.body).toEqual(firstConfirm.body);
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${winningToken}`)
        .set('Idempotency-Key', winningKey)
        .send({ ...approvalPayload, expectedPayloadHash: 'f'.repeat(64) })
        .expect(409);
      const recordId = firstConfirm.body.data.record.id as string;
      recordIds.push(recordId);
      expect(firstConfirm.body.data).toMatchObject({
        task: {
          status: OcrTaskStatus.confirmed,
          generatedRecordId: recordId,
          approval: {
            reviewRevision: 1,
            validationSnapshotHash: approvalPayload.expectedValidationSnapshotHash,
            policyVersion: 'finance-ocr-approval/1.0-pending-h10',
            snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            requestKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/)
          }
        },
        record: { sourceType: 'ocr', sourceId: taskId, amount: '1299.25', status: 'confirmed' }
      });
      const storedOcrRecord = await prisma.businessRecord.findUniqueOrThrow({ where: { id: recordId } });
      expect(storedOcrRecord.templateSnapshot).toMatchObject({
        templateId: 'dt-reimbursement',
        version: 1,
        accountingDirection: AccountingDirection.expense
      });
      expect(storedOcrRecord.sourceSnapshot).toMatchObject({
        sourceType: RecordSourceType.ocr,
        sourceId: taskId,
        metadata: {
          ocrTaskId: taskId,
          ocrAttemptId: expect.any(String),
          rawFileId,
          provider: 'mock',
          attemptNo: 1,
          providerConfigHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      });
      expect(storedOcrRecord.confirmationSnapshot).toMatchObject({
        projectId: 'dp-001',
        templateId: 'dt-reimbursement',
        amount: '1299.25',
        sourceType: RecordSourceType.ocr,
        sourceId: taskId,
        confirmedBy: winningApprover.username,
        ingestionApproval: {
          schemaVersion: 'ocr-approval/1.0',
          snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          validationSnapshotHash: approvalPayload.expectedValidationSnapshotHash,
          reviewRevision: 1,
          normalizedOutputHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      });
      const storedApprovedTask = await prisma.ocrTask.findUniqueOrThrow({ where: { id: taskId } });
      expect(storedApprovedTask).toMatchObject({
        approvalSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        approvalReviewRevision: 1,
        approvalValidationHash: approvalPayload.expectedValidationSnapshotHash,
        approvalPolicyVersion: 'finance-ocr-approval/1.0-pending-h10',
        approvalRequestKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        confirmedBy: winningApprover.id
      });
      expect(storedApprovedTask.approvalSnapshot).toMatchObject({
        schemaVersion: 'ocr-approval/1.0',
        approval: { approvedByUserId: winningApprover.id, selfApproval: false },
        review: {
          reviewRevision: 1,
          validationSnapshotHash: approvalPayload.expectedValidationSnapshotHash,
          candidatePayloadHash: approvalPayload.expectedPayloadHash
        },
        output: { recordCount: 1, normalizedOutputHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        snapshotHash: storedApprovedTask.approvalSnapshotHash
      });
      expect(await prisma.businessRecord.count({ where: { sourceType: RecordSourceType.ocr, sourceId: taskId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'ocr_task.confirm', resourceId: taskId } })).toBe(1);
      expect(await prisma.ledgerEvent.count({ where: { eventType: 'ocr_task_confirmed', aggregateId: taskId } })).toBe(1);
      const structure = await request(app.getHttpServer())
        .get('/api/projects/dp-001/structure')
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(structure.body.data.ocrTasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: taskId, status: OcrTaskStatus.confirmed, generatedRecordId: recordId })
      ]));
      expect(structure.body.data.logicalTablesSummary).toEqual(expect.arrayContaining([
        expect.objectContaining({ tableName: 'ocr_tasks', relatedCount: 2 }),
        expect.objectContaining({ tableName: 'ocr_corrections', relatedCount: 2 })
      ]));

      const failureCreated = await request(app.getHttpServer())
        .post('/api/ocr/tasks')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', `integration-ocr-${suffix}-retry`)
        .send({ ...createPayload, mockScenario: 'failure_once' })
        .expect(201);
      const failureTaskId = failureCreated.body.data.id as string;
      taskIds.push(failureTaskId);
      await request(app.getHttpServer())
        .post(`/api/ocr/tasks/${failureTaskId}/recognize`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe(OcrTaskStatus.queued));
      await waitForOcrStatus(failureTaskId, [OcrTaskStatus.failed]);
      expect(await prisma.ocrTask.findUniqueOrThrow({ where: { id: failureTaskId } })).toMatchObject({
        status: OcrTaskStatus.failed,
        attemptCount: 1
      });
      const retryQueued = await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${failureTaskId}/retry`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);
      expect(retryQueued.body.data).toMatchObject({
        status: OcrTaskStatus.queued,
        retryCount: 1,
        attemptCount: 1
      });
      await waitForOcrStatus(failureTaskId, [OcrTaskStatus.pending_confirm]);
      const retried = await request(app.getHttpServer())
        .get(`/api/ocr-tasks/${failureTaskId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(retried.body.data).toMatchObject({
        status: OcrTaskStatus.pending_confirm,
        retryCount: 1,
        attemptCount: 2
      });
      expect(await prisma.ocrAttempt.count({ where: { ocrTaskId: failureTaskId } })).toBe(2);
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${failureTaskId}/cancel`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);
    } finally {
      await prisma.idempotencyKey.deleteMany({ where: { key: { contains: suffix } } });
      const records = taskIds.length
        ? await prisma.businessRecord.findMany({ where: { sourceType: RecordSourceType.ocr, sourceId: { in: taskIds } }, select: { id: true } })
        : [];
      recordIds.push(...records.map((record) => record.id).filter((id) => !recordIds.includes(id)));
      if (recordIds.length) await prisma.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
      if (taskIds.length) await prisma.ocrTask.deleteMany({ where: { id: { in: taskIds } } });
      for (const storagePath of storagePaths) await fileStorage.remove(storagePath);
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      const resourceIds = [...taskIds, ...recordIds, ...rawFileIds];
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
      await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
    }
  });

  describe('B8-04 asynchronous OCR execution', () => {
    const setupHarness = async (label: string) => {
      const suffix = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'finance', password: '123456' })
        .expect(200);
      const token = login.body.data.accessToken as string;
      const pdf = await PDFDocument.create();
      pdf.addPage([320, 480]).drawText('Synthetic B8 OCR queue fixture', { x: 24, y: 430, size: 12 });
      const upload = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('relatedProjectId', 'dp-001')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: `${suffix}.pdf`,
          contentType: 'application/pdf'
        })
        .expect(201);
      const rawFileId = upload.body.data.id as string;
      const rawFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: rawFileId } });
      const taskIds: string[] = [];

      return {
        token,
        rawFileId,
        taskIds,
        createTask: async () => {
          const created = await request(app.getHttpServer())
            .post('/api/ocr-tasks')
            .set('Authorization', `Bearer ${token}`)
            .send({ rawFileId, projectId: 'dp-001', templateId: 'dt-reimbursement' })
            .expect(201);
          const taskId = created.body.data.id as string;
          taskIds.push(taskId);
          return taskId;
        },
        cleanup: async () => {
          const records = taskIds.length
            ? await prisma.businessRecord.findMany({
              where: { sourceType: RecordSourceType.ocr, sourceId: { in: taskIds } },
              select: { id: true }
            })
            : [];
          if (records.length) {
            await prisma.businessRecord.deleteMany({ where: { id: { in: records.map((item) => item.id) } } });
          }
          if (taskIds.length) await prisma.ocrTask.deleteMany({ where: { id: { in: taskIds } } });
          await fileStorage.remove(rawFile.storagePath);
          await prisma.rawFile.delete({ where: { id: rawFileId } });
          const resourceIds = [rawFileId, ...taskIds, ...records.map((item) => item.id)];
          await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
          await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
        }
      };
    };

    it.each([1, 3, 5])(
      'honors OCR concurrency %i, persists actual snapshots, and never auto-posts',
      async (maxConcurrency) => {
        const harness = await setupHarness(`concurrency-${maxConcurrency}`);
        const provider = app.get(MockOcrProvider);
        const originalSnapshot = provider.snapshot.bind(provider);
        const originalRecognize = provider.recognize.bind(provider);
        let active = 0;
        let peak = 0;
        let releaseInitialBatch!: () => void;
        let initialBatchReleased = false;
        let initialBatchTimer!: ReturnType<typeof setTimeout>;
        const initialBatchStarted = new Promise<void>((resolve, reject) => {
          releaseInitialBatch = resolve;
          initialBatchTimer = setTimeout(
            () => reject(new Error(`Timed out waiting for OCR concurrency ${maxConcurrency}`)),
            5_000
          );
        });
        const snapshotSpy = jest.spyOn(provider, 'snapshot').mockImplementation(() => ({
          ...originalSnapshot(),
          maxConcurrency,
          configSummary: { source: 'b8_integration', maxConcurrency }
        }));
        const recognizeSpy = jest.spyOn(provider, 'recognize').mockImplementation(async (input) => {
          active += 1;
          peak = Math.max(peak, active);
          try {
            if (!initialBatchReleased && active === maxConcurrency) {
              initialBatchReleased = true;
              clearTimeout(initialBatchTimer);
              releaseInitialBatch();
            }
            await initialBatchStarted;
            await new Promise((resolve) => setTimeout(resolve, 60));
            return await originalRecognize(input);
          } finally {
            active -= 1;
          }
        });
        const recordsBefore = await prisma.businessRecord.count();
        try {
          const taskIds = await Promise.all(Array.from({ length: 5 }, () => harness.createTask()));
          const apiStarted = Date.now();
          const queued = await Promise.all(taskIds.map((taskId) => request(app.getHttpServer())
            .post(`/api/ocr-tasks/${taskId}/run`)
            .set('Authorization', `Bearer ${harness.token}`)
            .expect(201)));
          expect(Date.now() - apiStarted).toBeLessThan(2_000);
          expect(queued.every((response) => response.body.data.status === OcrTaskStatus.queued)).toBe(true);
          await Promise.all(taskIds.map((taskId) => waitForOcrStatus(taskId, [OcrTaskStatus.pending_confirm])));

          expect(peak).toBe(maxConcurrency);
          expect(recognizeSpy).toHaveBeenCalledTimes(5);
          const stored = await prisma.ocrTask.findMany({
            where: { id: { in: taskIds } },
            include: { attempts: true }
          });
          const queueLatencies = stored.map((task) => {
            const attempt = task.attempts[0];
            expect(attempt).toMatchObject({
              status: OcrAttemptStatus.succeeded,
              provider: 'mock',
              providerConfigHash: expect.stringMatching(/^[a-f0-9]{64}$/),
              providerConfig: { source: 'b8_integration', maxConcurrency }
            });
            expect(JSON.stringify(attempt.providerConfig)).not.toContain('secret');
            return attempt.startedAt!.getTime() - task.queuedAt!.getTime();
          });
          if (maxConcurrency === 1) expect(Math.max(...queueLatencies)).toBeGreaterThan(60);
          expect(await prisma.businessRecord.count()).toBe(recordsBefore);
        } finally {
          clearTimeout(initialBatchTimer);
          snapshotSpy.mockRestore();
          recognizeSpy.mockRestore();
          await harness.cleanup();
        }
      }
    );

    it('renews the processing lease and discards results after queued or processing cancellation', async () => {
      const harness = await setupHarness('cancel-heartbeat');
      const provider = app.get(MockOcrProvider);
      const service = app.get(OcrTasksService);
      const originalSnapshot = provider.snapshot.bind(provider);
      const originalRecognize = provider.recognize.bind(provider);
      const originalLeaseMs = (service as any).processingLeaseMs as number;
      let release!: () => void;
      const blocker = new Promise<void>((resolve) => { release = resolve; });
      const snapshotSpy = jest.spyOn(provider, 'snapshot').mockImplementation(() => ({
        ...originalSnapshot(),
        maxConcurrency: 1,
        configSummary: { source: 'b8_cancel_test' }
      }));
      const recognizeSpy = jest.spyOn(provider, 'recognize').mockImplementation(async (input) => {
        await blocker;
        return originalRecognize(input);
      });
      (service as any).processingLeaseMs = 1_500;
      const recordsBefore = await prisma.businessRecord.count();
      try {
        const processingId = await harness.createTask();
        const queuedId = await harness.createTask();
        await request(app.getHttpServer())
          .post(`/api/ocr-tasks/${processingId}/run`)
          .set('Authorization', `Bearer ${harness.token}`)
          .expect(201);
        const processing = await waitForOcrStatus(processingId, [OcrTaskStatus.processing]);
        const firstLease = processing.leaseUntil!.getTime();

        await request(app.getHttpServer())
          .post(`/api/ocr-tasks/${queuedId}/run`)
          .set('Authorization', `Bearer ${harness.token}`)
          .expect(201);
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        const heartbeat = await prisma.ocrTask.findUniqueOrThrow({ where: { id: processingId } });
        expect(heartbeat.leaseUntil!.getTime()).toBeGreaterThan(firstLease);

        await request(app.getHttpServer())
          .post(`/api/ocr-tasks/${queuedId}/cancel`)
          .set('Authorization', `Bearer ${harness.token}`)
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/ocr-tasks/${processingId}/cancel`)
          .set('Authorization', `Bearer ${harness.token}`)
          .expect(201);
        release();
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(recognizeSpy).toHaveBeenCalledTimes(1);
        expect(await prisma.ocrTask.findUniqueOrThrow({ where: { id: queuedId } }))
          .toMatchObject({ status: OcrTaskStatus.cancelled, attemptCount: 0 });
        expect(await prisma.ocrTask.findUniqueOrThrow({ where: { id: processingId } }))
          .toMatchObject({ status: OcrTaskStatus.cancelled, generatedRecordId: null });
        expect(await prisma.businessRecord.count()).toBe(recordsBefore);
      } finally {
        release();
        (service as any).processingLeaseMs = originalLeaseMs;
        snapshotSpy.mockRestore();
        recognizeSpy.mockRestore();
        await harness.cleanup();
      }
    });

    it('recovers queued and expired processing tasks from durable database state', async () => {
      const harness = await setupHarness('restart-recovery');
      const service = app.get(OcrTasksService);
      const finance = await prisma.user.findUniqueOrThrow({ where: { username: 'finance' } });
      const recordsBefore = await prisma.businessRecord.count();
      try {
        const queuedId = await harness.createTask();
        await prisma.ocrTask.update({
          where: { id: queuedId },
          data: {
            status: OcrTaskStatus.queued,
            queuedAt: new Date(),
            runRequestedBy: finance.id,
            runRequestId: `restart-${queuedId}`
          }
        });
        await service.recoverQueuedTasks();
        await waitForOcrStatus(queuedId, [OcrTaskStatus.pending_confirm]);

        const expiredId = await harness.createTask();
        await prisma.ocrTask.update({
          where: { id: expiredId },
          data: {
            status: OcrTaskStatus.processing,
            attemptCount: 1,
            runRequestedBy: finance.id,
            runRequestId: `expired-${expiredId}`,
            leaseToken: `expired-${expiredId}`,
            leaseUntil: new Date(Date.now() - 1_000)
          }
        });
        await prisma.ocrAttempt.create({
          data: {
            ocrTaskId: expiredId,
            attemptNo: 1,
            status: OcrAttemptStatus.processing,
            provider: 'mock',
            modelName: 'stale-model',
            modelVersion: 'stale-version',
            providerConfig: { source: 'expired_worker' },
            providerConfigHash: 'f'.repeat(64),
            inputSha256: (await prisma.rawFile.findUniqueOrThrow({ where: { id: harness.rawFileId } })).sha256,
            correlationId: `expired-${expiredId}`,
            startedAt: new Date(Date.now() - 2_000)
          }
        });
        await expect(service.recoverExpiredTasks()).resolves.toBe(1);
        await service.recoverQueuedTasks();
        await waitForOcrStatus(expiredId, [OcrTaskStatus.pending_confirm]);

        const attempts = await prisma.ocrAttempt.findMany({
          where: { ocrTaskId: expiredId },
          orderBy: { attemptNo: 'asc' }
        });
        expect(attempts).toMatchObject([
          { attemptNo: 1, status: OcrAttemptStatus.failed },
          { attemptNo: 2, status: OcrAttemptStatus.succeeded }
        ]);
        expect(await prisma.businessRecord.count()).toBe(recordsBefore);
      } finally {
        await harness.cleanup();
      }
    });
  });

  it('rolls back a real database transaction when the callback fails', async () => {
    const username = `${TEST_USER_PREFIX}rollback`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            username,
            passwordHash: await bcrypt.hash('123456', 4),
            name: '事务回滚测试',
            role: UserRole.employee
          }
        });
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    await expect(prisma.user.findUnique({ where: { username } })).resolves.toBeNull();
  });

  it('enforces PostgreSQL unique and foreign-key constraints', async () => {
    const username = `${TEST_USER_PREFIX}unique`;
    const passwordHash = await bcrypt.hash('123456', 4);
    await prisma.user.create({
      data: { username, passwordHash, name: '唯一约束测试', role: UserRole.employee }
    });

    await expect(
      prisma.user.create({
        data: { username, passwordHash, name: '重复账号', role: UserRole.employee }
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.projectTemplate.create({
        data: {
          projectId: 'missing-project-for-integration-test',
          templateId: 'missing-template-for-integration-test',
          recordType: DataRecordType.cost
        }
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('contains every Prisma model table in the migrated PostgreSQL schema', async () => {
    const expectedTables = Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name);
    const actualTables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT tablename AS name
      FROM pg_catalog.pg_tables
      WHERE schemaname = current_schema()
    `;
    const actualNames = actualTables.map((row) => row.name);

    expect(actualNames).toEqual(expect.arrayContaining(expectedTables));
  });
});
