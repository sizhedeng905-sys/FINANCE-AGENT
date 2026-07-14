import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AccountingDirection,
  AiMessageRole,
  BusinessRecordStatus,
  DataRecordType,
  FileScanStatus,
  FieldType,
  ImportRowStatus,
  ImportTaskStatus,
  OcrAttemptStatus,
  OcrTaskStatus,
  Prisma,
  ProjectStatus,
  RawFileStatus,
  RecordSourceType,
  SemanticType,
  UserRole,
  UserStatus,
  WorkOrderStatus,
  WorkOrderType
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { LocalFileStorageService } from '../../src/files/local-file-storage.service';
import { PrismaService } from '../../src/prisma/prisma.service';
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
    const expiredToken = await jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion },
      { secret, expiresIn: -1 }
    );
    const staleToken = await jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion + 1 },
      { secret, expiresIn: '5m' }
    );

    const attempts = [
      () => request(app.getHttpServer()).get('/api/auth/me'),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer forged.token.value'),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${expiredToken}`),
      () => request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${staleToken}`)
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

  it('protects the final active boss in PostgreSQL mode', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: '123456' })
      .expect(200);
    const bossToken = loginResponse.body.data.accessToken as string;
    const englishBoss = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } });
    const chineseBoss = await prisma.user.findUniqueOrThrow({ where: { username: '老板' } });

    try {
      await request(app.getHttpServer())
        .patch(`/api/users/${chineseBoss.id}/status`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: UserStatus.disabled })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/users/${englishBoss.id}/status`)
        .set('Authorization', `Bearer ${bossToken}`)
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
    let projectId: string | undefined;

    try {
      await request(app.getHttpServer())
        .post('/api/projects')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({
          name: `${TEST_USER_PREFIX}forged_project`,
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
          name: `  ${TEST_USER_PREFIX}project  `,
          customerName: '  集成测试客户  ',
          ownerName: '  集成负责人  ',
          description: '  项目真实权限测试  '
        })
        .expect(201);
      projectId = createResponse.body.data.id as string;
      expect(createResponse.body.data).toMatchObject({
        name: `${TEST_USER_PREFIX}project`,
        customerName: '集成测试客户',
        ownerName: '集成负责人',
        status: ProjectStatus.active
      });

      const pageResponse = await request(app.getHttpServer())
        .get(`/api/projects?keyword=${TEST_USER_PREFIX}&page=1&pageSize=1`)
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
        .get(`/api/projects?keyword=${TEST_USER_PREFIX}&status=archived`)
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
        .get(`/api/projects?keyword=${TEST_USER_PREFIX}`)
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
          name: `${TEST_USER_PREFIX}forged_system_template`,
          recordType: 'cost',
          isSystem: true
        })
        .expect(400);

      const createResponse = await request(app.getHttpServer())
        .post('/api/templates')
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-create')
        .send({
          name: `  ${TEST_USER_PREFIX}template  `,
          recordType: 'cost',
          description: '  集成模板测试  '
        })
        .expect(201);
      const customTemplateId = createResponse.body.data.id as string;
      templateIds.push(customTemplateId);
      expect(createResponse.body.data).toMatchObject({
        name: `${TEST_USER_PREFIX}template`,
        description: '集成模板测试',
        isSystem: false
      });

      const listResponse = await request(app.getHttpServer())
        .get(`/api/templates?keyword=${TEST_USER_PREFIX}&recordType=cost&page=1&pageSize=1`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(listResponse.body.data).toMatchObject({ page: 1, pageSize: 1, total: 1 });
      expect(listResponse.body.data.items).toHaveLength(1);

      await request(app.getHttpServer())
        .patch(`/api/templates/${customTemplateId}`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', 'integration-template-update')
        .send({ name: `  ${TEST_USER_PREFIX}template_updated  ` })
        .expect(200)
        .expect(({ body }) => expect(body.data.name).toBe(`${TEST_USER_PREFIX}template_updated`));

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
      expect(cloneResponse.body.data).toMatchObject({ isSystem: false, name: '运输费用模板 副本' });
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
      await request(app.getHttpServer())
        .patch(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .set('X-Request-Id', `integration-work-order-update-${suffix}`)
        .send({
          amount: '2450.50',
          description: '  PostgreSQL workflow expense  ',
          occurredDate: '2026-07-18',
          extraValues: { expenseType: '人工' }
        })
        .expect(200)
        .expect(({ body }) => expect(body.data.description).toBe('PostgreSQL workflow expense'));
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

      const storedWorkOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
      expect(storedWorkOrder).toMatchObject({
        creatorId: employee.id,
        creationIdempotencyKey: creationKey,
        approvalIdempotencyKey: approvalKey,
        status: WorkOrderStatus.completed,
        generatedRecordId
      });
      expect(storedWorkOrder.occurredDate?.toISOString()).toBe('2026-07-18T00:00:00.000Z');
      expect(await prisma.businessRecord.count({
        where: { sourceType: RecordSourceType.work_order, sourceId: workOrderId }
      })).toBe(1);
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
      const workOrderIds = [workOrderId, raceWorkOrderId].filter((id): id is string => Boolean(id));
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
    } = {}) => {
      const uploadRequest = request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', options.requestId ?? `integration-file-${suffix}`)
        .field('relatedProjectId', targetProjectId);
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

      const uploadedResponse = await upload(tokens.employee, project.id, validPdf, {
        workOrderId,
        name: '付款凭证.pdf',
        requestId: `integration-file-upload-${suffix}`
      }).expect(201);
      const fileId = uploadedResponse.body.data.id as string;
      rawFileIds.push(fileId);
      expect(uploadedResponse.body.data).toMatchObject({
        originalFileName: '付款凭证.pdf',
        fileSize: validPdf.length,
        relatedProjectId: project.id,
        relatedWorkOrderId: workOrderId,
        isVoided: false
      });
      expect(uploadedResponse.body.data.sha256).toMatch(/^[a-f0-9]{64}$/);
      const storedFile = await prisma.rawFile.findUniqueOrThrow({ where: { id: fileId } });
      storagePaths.push(storedFile.storagePath);
      expect(storedFile.storagePath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
      expect(storedFile.storagePath).not.toContain('付款凭证');

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
        .expect(200);
      expect(Buffer.isBuffer(preview.body)).toBe(true);
      expect(preview.body.equals(validPdf)).toBe(true);
      const download = await request(app.getHttpServer())
        .get(`/api/files/${fileId}/download`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-file-download-${suffix}`)
        .expect('Content-Disposition', /attachment/)
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
    const recordIds = Array.from({ length: 7 }, (_, index) => `${projectId}_record_${index + 1}`);
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
    const usernames = ['boss', '老板', 'finance', 'employee', 'reviewer'] as const;
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
      expect(today).toMatchObject({ provider: 'mock', fallback: false, toolsUsed: ['get_today_report'] });
      expect(today.reply).toMatch(/收入.*元.*支出.*元.*利润.*元/);

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
      expect(workOrder.toolsUsed).toEqual(['get_work_order_detail', 'get_anomalies']);
      expect(workOrder.reply).toContain('WO202607110001');

      const missing = await chat('不存在项目利润多少', 6);
      expect(missing.toolsUsed).toEqual(['get_project_summary']);
      expect(missing.reply).toContain('需要人工确认');
      expect(missing.reply).not.toMatch(/不存在项目.*\d+元/);

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
        expect.objectContaining({ id: conversationId, messageCount: 12 })
      ]));
      const ownMessages = await request(app.getHttpServer())
        .get(`/api/ai/conversations/${conversationId}/messages?page=1&pageSize=5`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(ownMessages.body.data).toMatchObject({ page: 1, pageSize: 5, total: 12 });
      expect(ownMessages.body.data.items).toHaveLength(5);
      await request(app.getHttpServer())
        .get(`/api/ai/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${tokens['老板']}`)
        .expect(403);
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

      const [messages, logs, audits] = await Promise.all([
        prisma.aiMessage.findMany({ where: { conversationId } }),
        prisma.aiCallLog.findMany({ where: { id: { in: callLogIds } } }),
        prisma.auditLog.findMany({ where: { resourceId: conversationId, action: 'ai.chat' } })
      ]);
      expect(messages).toHaveLength(12);
      expect(messages.filter((item) => item.role === AiMessageRole.user)).toHaveLength(6);
      expect(messages.filter((item) => item.role === AiMessageRole.assistant)).toHaveLength(6);
      expect(logs).toHaveLength(6);
      expect(new Set(callLogIds).size).toBe(6);
      expect(logs.every((item) => item.success && item.provider === 'mock' && item.createdBy === bossUser.id)).toBe(true);
      expect(logs.every((item) => /^[a-f0-9]{64}$/.test(item.inputHash ?? ''))).toBe(true);
      expect(logs.map((item) => item.correlationId)).toEqual(expect.arrayContaining(
        Array.from({ length: 6 }, (_, index) => `${requestPrefix}-${index + 1}`)
      ));
      expect(logs.every((item) => item.attemptNo === 1 && item.fallback === false)).toBe(true);
      expect(JSON.stringify(logs.map((item) => item.requestPayload))).not.toMatch(/Bearer|123456|JWT_SECRET/i);
      expect(audits).toHaveLength(6);
      expect(audits.map((item) => item.requestId)).toEqual(expect.arrayContaining(
        Array.from({ length: 6 }, (_, index) => `${requestPrefix}-${index + 1}`)
      ));
    } finally {
      if (callLogIds.length) await prisma.aiCallLog.deleteMany({ where: { id: { in: callLogIds } } });
      if (conversationId) {
        await prisma.auditLog.deleteMany({ where: { resourceId: conversationId } });
        await prisma.aiConversation.deleteMany({ where: { id: conversationId } });
      }
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
    expect(await prisma.taskModelRoute.count()).toBe(5);
  });

  it('imports a real XLSX with mapping decisions, partial success, idempotency, and report visibility', async () => {
    const usernames = ['employee', 'finance', 'boss'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof usernames)[number], string>;
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
    multiDetail.addRow(['发生日期', '费用', null]);
    multiDetail.addRow([null, '金额', '说明']);
    multiDetail.addRow(['2026-07-01', 200, '合成明细']);
    multiDetail.mergeCells('A1:A2');
    multiDetail.mergeCells('B1:C1');
    const hiddenArchive = multiWorkbook.addWorksheet('历史归档');
    hiddenArchive.state = 'hidden';
    hiddenArchive.addRows([
      ['日期', '金额'],
      ['2025-01-01', 10]
    ]);
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
        sheets: [
          { sheetIndex: 0, sheetName: '汇总', state: 'visible' },
          { sheetIndex: 1, sheetName: '费用明细', state: 'visible' },
          { sheetIndex: 2, sheetName: '历史归档', state: 'hidden' }
        ]
      });
      expect(await prisma.auditLog.count({ where: { action: 'import_task.inspect', resourceId: multiTaskId } })).toBe(1);
      expect(await prisma.ledgerEvent.count({ where: { eventType: 'import_task_inspected', aggregateId: multiTaskId } })).toBe(1);

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
        .send({ sheetIndex: 1, headerStartRowIndex: 1, headerRowIndex: 2 })
        .expect(201);
      expect(selectedParse.body.data).toMatchObject({
        status: ImportTaskStatus.mapping,
        sheets: [{ index: 1, headerRowIndex: 2, rowCount: 1 }]
      });
      expect(selectedParse.body.data.columns.map((column: { sourceName: string }) => column.sourceName)).toEqual([
        '发生日期',
        '费用 / 金额',
        '费用 / 说明'
      ]);
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
        .expect(409);

      const approved = await request(app.getHttpServer())
        .post(`/api/field-suggestions/${upstairs!.suggestion!.id}/approve`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ fieldName: '上楼费', fieldType: FieldType.money })
        .expect(201);
      suggestedFieldId = approved.body.data.fieldId as string;
      activeTemplateId = approved.body.data.templateId as string;
      expect(activeTemplateId).not.toBe(template.id);

      const mapped = await request(app.getHttpServer())
        .put(`/api/import-tasks/${taskId}/mappings`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-import-mapping-${suffix}`)
        .send({ mappings: [{ columnId: note!.id, ignore: true }], saveToProfile: true })
        .expect(200);
      expect(mapped.body.data.status).toBe(ImportTaskStatus.pending_confirm);

      const preview = await request(app.getHttpServer())
        .get(`/api/import-tasks/${taskId}/preview`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(preview.body.data).toMatchObject({
        unresolvedColumns: [],
        strategy: 'valid_rows_only',
        summary: { total: 6, valid: 1, errors: 3, duplicates: 1, ignored: 1 }
      });
      expect(preview.body.data.rows.find((row: { rowNumber: number }) => row.rowNumber === 3).errors).toContain('费用金额：数字格式错误');
      expect(preview.body.data.rows.find((row: { rowNumber: number }) => row.rowNumber === 6).errors).toContain('发生日期：日期无效');

      const confirm = () => request(app.getHttpServer())
        .post(`/api/import-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-import-confirm-${suffix}`);
      const [firstConfirm, secondConfirm] = await Promise.all([confirm(), confirm()]);
      expect([firstConfirm.status, secondConfirm.status]).toEqual([201, 201]);
      expect(firstConfirm.body.data.recordIds).toEqual(secondConfirm.body.data.recordIds);
      expect(firstConfirm.body.data.recordIds).toHaveLength(1);
      recordIds.push(...firstConfirm.body.data.recordIds);

      const records = await prisma.businessRecord.findMany({
        where: { importTaskId: taskId },
        include: { values: { include: { field: true } } }
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        sourceType: RecordSourceType.excel,
        sourceId: storedRows[0].id,
        status: BusinessRecordStatus.confirmed,
        importTaskId: taskId
      });
      expect(Number(records[0].amount)).toBe(8200);
      expect(records[0].values.find((value) => value.fieldId === suggestedFieldId)?.valueNumber?.toNumber()).toBe(300);

      const recordsApi = await request(app.getHttpServer())
        .get(`/api/records?importTaskId=${taskId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(recordsApi.body.data).toMatchObject({ total: 1, items: [{ id: records[0].id, sourceType: 'excel' }] });
      const projectStructure = await request(app.getHttpServer())
        .get(`/api/projects/${project.id}/structure`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);
      expect(projectStructure.body.data.importTasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: taskId, counts: expect.objectContaining({ imported: 1 }) })
      ]));
      expect(projectStructure.body.data.fieldUsageStats).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldId: suggestedFieldId, usageCount: 1 })
      ]));
      expect(projectStructure.body.data.logicalTablesSummary).toEqual(expect.arrayContaining([
        expect.objectContaining({ tableName: 'import_tasks', relatedCount: 2 }),
        expect.objectContaining({ tableName: 'import_rows', relatedCount: 7 })
      ]));
      const projectReport = await request(app.getHttpServer())
        .get(`/api/reports/projects/${project.id}/daily?date=2026-07-01`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(200);
      expect(projectReport.body.data).toMatchObject({ expense: '8200.00', recordCount: 1 });

      expect(await prisma.auditLog.count({ where: { action: 'import_task.confirm', resourceId: taskId } })).toBe(1);
      expect(await prisma.ledgerEvent.count({ where: { eventType: 'import_task_confirmed', aggregateId: taskId } })).toBe(1);
      expect(await prisma.ledgerEvent.count({ where: { eventType: 'business_record_created', aggregateId: records[0].id } })).toBe(1);

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

  it('runs OCR through human correction, idempotent confirmation, and recoverable retry', async () => {
    const usernames = ['employee', 'finance', 'boss'] as const;
    const tokens = Object.fromEntries(await Promise.all(usernames.map(async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return [username, response.body.data.accessToken as string] as const;
    }))) as Record<(typeof usernames)[number], string>;
    const suffix = Date.now().toString(36);
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
      expect(repeatedCreate.body.data.id).toBe(taskId);

      await request(app.getHttpServer())
        .get(`/api/ocr-tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.employee}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/ocr-tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.boss}`)
        .expect(200);

      const recognized = await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/run`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-ocr-run-${suffix}`)
        .expect(201);
      expect(recognized.body.data).toMatchObject({
        status: OcrTaskStatus.pending_confirm,
        extractedText: expect.stringContaining('金额'),
        attemptCount: 1,
        attempts: [expect.objectContaining({ status: OcrAttemptStatus.succeeded, attemptNo: 1 })]
      });
      const candidates = recognized.body.data.fields as Array<{
        fieldId: string;
        fieldName: string;
        normalizedValue: unknown;
        confidence: number;
        lowConfidence: boolean;
      }>;
      const lowField = candidates.find((candidate) => candidate.lowConfidence);
      const amountField = candidates.find((candidate) => candidate.fieldName === '金额');
      expect(lowField).toMatchObject({ confidence: 0.55, lowConfidence: true });
      expect(amountField).toBeTruthy();
      expect(await prisma.businessRecord.count({ where: { sourceType: RecordSourceType.ocr, sourceId: taskId } })).toBe(0);

      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .send({ acknowledgeLowConfidence: true })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', `integration-ocr-confirm-${suffix}`)
        .send({ acknowledgeLowConfidence: false })
        .expect(409);

      const corrected = await request(app.getHttpServer())
        .put(`/api/ocr-tasks/${taskId}/corrections`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('X-Request-Id', `integration-ocr-correct-${suffix}`)
        .send({
          corrections: [
            { fieldId: lowField!.fieldId, correctedValue: '2026-07-01', reason: '人工核对票据日期' },
            { fieldId: amountField!.fieldId, correctedValue: '1299.25', reason: '人工核对票据金额' }
          ]
        })
        .expect(200);
      expect(corrected.body.data.corrections).toEqual(expect.arrayContaining([
        expect.objectContaining({ fieldId: lowField!.fieldId, beforeValue: expect.any(String), afterValue: '2026-07-01' }),
        expect.objectContaining({ fieldId: amountField!.fieldId, afterValue: '1299.25' })
      ]));
      expect(await prisma.ocrCorrection.count({ where: { ocrTaskId: taskId } })).toBe(2);

      const confirm = (key: string) => request(app.getHttpServer())
        .post(`/api/ocr-tasks/${taskId}/confirm`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .set('Idempotency-Key', key)
        .send({ acknowledgeLowConfidence: true });
      const [firstConfirm, secondConfirm] = await Promise.all([
        confirm(`integration-ocr-confirm-${suffix}-a`),
        confirm(`integration-ocr-confirm-${suffix}-b`)
      ]);
      expect([firstConfirm.status, secondConfirm.status]).toEqual([201, 201]);
      expect(firstConfirm.body.data.record.id).toBe(secondConfirm.body.data.record.id);
      const recordId = firstConfirm.body.data.record.id as string;
      recordIds.push(recordId);
      expect(firstConfirm.body.data).toMatchObject({
        task: { status: OcrTaskStatus.confirmed, generatedRecordId: recordId },
        record: { sourceType: 'ocr', sourceId: taskId, amount: '1299.25', status: 'confirmed' }
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
        expect.objectContaining({ tableName: 'ocr_tasks', relatedCount: 1 }),
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
        .expect(503);
      expect(await prisma.ocrTask.findUniqueOrThrow({ where: { id: failureTaskId } })).toMatchObject({
        status: OcrTaskStatus.failed,
        attemptCount: 1
      });
      const retried = await request(app.getHttpServer())
        .post(`/api/ocr-tasks/${failureTaskId}/retry`)
        .set('Authorization', `Bearer ${tokens.finance}`)
        .expect(201);
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
