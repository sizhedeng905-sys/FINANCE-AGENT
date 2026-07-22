import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StepUpGrantStatus, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

const TEST_PREFIX = 'step_up_integration_';
const PASSWORD = '123456';

describe('step-up PostgreSQL enforcement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let adminToken: string;

  const previous = {
    mode: process.env.STEP_UP_MODE,
    actions: process.env.STEP_UP_ENFORCED_ACTIONS,
    ttl: process.env.STEP_UP_TTL_SECONDS,
    role: process.env.PROCESS_ROLE
  };

  beforeAll(async () => {
    process.env.STEP_UP_MODE = 'enforce';
    process.env.STEP_UP_ENFORCED_ACTIONS = 'user.status.update';
    process.env.STEP_UP_TTL_SECONDS = '60';
    process.env.PROCESS_ROLE = 'api';

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
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    await cleanupUsers();
    adminToken = await login('admin', PASSWORD);
  });

  afterAll(async () => {
    if (prisma) await cleanupUsers();
    if (app) await app.close();
    restore('STEP_UP_MODE', previous.mode);
    restore('STEP_UP_ENFORCED_ACTIONS', previous.actions);
    restore('STEP_UP_TTL_SECONDS', previous.ttl);
    restore('PROCESS_ROLE', previous.role);
  });

  it('requires an action-bound token and consumes it exactly once', async () => {
    const target = await createUser('single_use', UserRole.employee);
    const withoutStepUp = await updateStatus(adminToken, target.id, UserStatus.active);
    expect(withoutStepUp.status).toBe(401);

    const token = await issue(adminToken, PASSWORD, 'user.status.update', 'user', target.id);
    await updateStatus(adminToken, target.id, UserStatus.active, token).expect(200);
    await updateStatus(adminToken, target.id, UserStatus.active, token).expect(401);

    const grants = await prisma.stepUpGrant.findMany({
      where: { action: 'user.status.update', resourceId: target.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(grants[0]).toMatchObject({
      status: StepUpGrantStatus.consumed,
      maxUses: 1,
      useCount: 1,
      consumedAt: expect.any(Date)
    });
    await expect(prisma.auditLog.count({
      where: { action: 'auth.step_up.consumed', resourceId: target.id }
    })).resolves.toBe(1);
  });

  it('allows only one winner when the same grant is replayed concurrently', async () => {
    const target = await createUser('concurrent', UserRole.employee);
    const token = await issue(adminToken, PASSWORD, 'user.status.update', 'user', target.id);

    const responses = await Promise.all([
      updateStatus(adminToken, target.id, UserStatus.active, token),
      updateStatus(adminToken, target.id, UserStatus.active, token)
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);

    const grant = await prisma.stepUpGrant.findFirstOrThrow({
      where: { action: 'user.status.update', resourceId: target.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(grant).toMatchObject({ status: StepUpGrantStatus.consumed, useCount: 1 });
    await expect(prisma.auditLog.count({
      where: { action: 'auth.step_up.consumed', resourceId: target.id }
    })).resolves.toBe(1);
  });

  it('rejects wrong action, wrong resource, wrong session, and a forged user binding', async () => {
    const target = await createUser('bindings', UserRole.employee);
    const other = await createUser('bindings_other', UserRole.employee);
    const secondSession = await login('admin', PASSWORD);

    const wrongAction = await issue(adminToken, PASSWORD, 'user.password.reset', 'user', target.id);
    await updateStatus(adminToken, target.id, UserStatus.active, wrongAction).expect(401);

    const wrongResource = await issue(adminToken, PASSWORD, 'user.status.update', 'user', other.id);
    await updateStatus(adminToken, target.id, UserStatus.active, wrongResource).expect(401);

    const sessionBound = await issue(adminToken, PASSWORD, 'user.status.update', 'user', target.id);
    await updateStatus(secondSession, target.id, UserStatus.active, sessionBound).expect(401);

    const accessPayload = jwt.decode(adminToken) as Record<string, unknown>;
    const forged = await jwt.signAsync(
      {
        sub: other.id,
        ver: accessPayload.ver,
        typ: 'step_up',
        sid: accessPayload.sid,
        act: 'user.status.update',
        rty: 'user',
        rid: target.id,
        jti: randomUUID()
      },
      {
        secret: config.getOrThrow<string>('jwtSecret'),
        expiresIn: 60,
        algorithm: 'HS256',
        issuer: config.getOrThrow<string>('jwtIssuer'),
        audience: config.getOrThrow<string>('jwtAudience')
      }
    );
    await updateStatus(adminToken, target.id, UserStatus.active, forged).expect(401);
  });

  it('rejects an expired persisted grant even while its JWT is still valid', async () => {
    const target = await createUser('expired', UserRole.employee);
    const token = await issue(adminToken, PASSWORD, 'user.status.update', 'user', target.id);
    await prisma.stepUpGrant.updateMany({
      where: { action: 'user.status.update', resourceId: target.id, status: StepUpGrantStatus.active },
      data: { expiresAt: new Date(Date.now() - 1_000) }
    });
    await updateStatus(adminToken, target.id, UserStatus.active, token).expect(401);
  });

  it('revokes grants after role downgrade, password reset, account disable, and logout', async () => {
    const target = await createUser('identity_target', UserRole.employee);
    const actor = await createUser('identity_actor', UserRole.admin);
    let actorPassword = PASSWORD;
    let actorToken = await login(actor.username, actorPassword);

    const roleGrant = await issue(actorToken, actorPassword, 'user.status.update', 'user', target.id);
    await request(app.getHttpServer())
      .patch(`/api/users/${actor.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: UserRole.finance })
      .expect(200);
    actorToken = await login(actor.username, actorPassword);
    await updateStatus(actorToken, target.id, UserStatus.active, roleGrant).expect(401);
    await expect(latestGrantStatus(actor.id, target.id)).resolves.toBe(StepUpGrantStatus.revoked);

    const passwordGrant = await issue(actorToken, actorPassword, 'user.status.update', 'user', target.id);
    actorPassword = '654321';
    await request(app.getHttpServer())
      .patch(`/api/users/${actor.id}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: actorPassword })
      .expect(200);
    actorToken = await login(actor.username, actorPassword);
    await updateStatus(actorToken, target.id, UserStatus.active, passwordGrant).expect(401);
    await expect(latestGrantStatus(actor.id, target.id)).resolves.toBe(StepUpGrantStatus.revoked);

    const disableGrant = await issue(actorToken, actorPassword, 'user.status.update', 'user', target.id);
    const adminDisableGrant = await issue(
      adminToken,
      PASSWORD,
      'user.status.update',
      'user',
      actor.id
    );
    await updateStatus(adminToken, actor.id, UserStatus.disabled, adminDisableGrant).expect(200);
    await updateStatus(actorToken, target.id, UserStatus.active, disableGrant).expect(401);
    await expect(latestGrantStatus(actor.id, target.id)).resolves.toBe(StepUpGrantStatus.revoked);

    const logoutActor = await createUser('logout_actor', UserRole.finance);
    const logoutToken = await login(logoutActor.username, PASSWORD);
    await issue(logoutToken, PASSWORD, 'user.status.update', 'user', target.id);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${logoutToken}`)
      .expect(200);
    await expect(latestGrantStatus(logoutActor.id, target.id)).resolves.toBe(StepUpGrantStatus.revoked);
  });

  it('publishes truthful disabled-MFA and enforced-action capabilities', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/security-capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      mfa: { status: 'reserved', enabled: false },
      stepUp: {
        status: 'enforced_for_configured_actions',
        mode: 'enforce',
        enforcedActions: ['user.status.update'],
        maxUses: 1,
        tokenHeader: 'X-Step-Up-Token',
        pendingDecisionRefs: ['H10']
      }
    });

    await request(app.getHttpServer())
      .post('/api/auth/step-up')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        password: PASSWORD,
        action: 'unregistered.action',
        resourceType: 'user',
        resourceId: 'target'
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/auth/step-up')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        password: PASSWORD,
        action: 'user.status.update',
        resourceType: 'user',
        resourceId: 'target\r\nforged-log-line'
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/auth/step-up')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        password: PASSWORD,
        action: 'model.route.update',
        resourceType: 'model_route',
        resourceId: 'synthetic-route'
      })
      .expect(400);
  });

  async function createUser(label: string, role: UserRole) {
    return prisma.user.create({
      data: {
        username: `${TEST_PREFIX}${label}_${randomUUID().slice(0, 8)}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        name: `Step-up ${label}`,
        role
      }
    });
  }

  async function login(username: string, password: string) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  async function issue(
    accessToken: string,
    password: string,
    action: 'user.status.update' | 'user.password.reset',
    resourceType: 'user',
    resourceId: string
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/step-up')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password, action, resourceType, resourceId })
      .expect(200);
    return response.body.data.stepUpToken as string;
  }

  function updateStatus(
    accessToken: string,
    userId: string,
    status: UserStatus,
    stepUpToken?: string
  ) {
    const call = request(app.getHttpServer())
      .patch(`/api/users/${userId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status });
    if (stepUpToken) call.set('X-Step-Up-Token', stepUpToken);
    return call;
  }

  async function latestGrantStatus(userId: string, resourceId: string) {
    const grant = await prisma.stepUpGrant.findFirstOrThrow({
      where: { userId, action: 'user.status.update', resourceId },
      orderBy: { createdAt: 'desc' }
    });
    return grant.status;
  }

  async function cleanupUsers() {
    const users = await prisma.user.findMany({
      where: { username: { startsWith: TEST_PREFIX } },
      select: { id: true }
    });
    const ids = users.map((user) => user.id);
    if (ids.length > 0) {
      await prisma.notification.deleteMany({
        where: { OR: [{ senderId: { in: ids } }, { targetUserId: { in: ids } }] }
      });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  }

  function restore(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
