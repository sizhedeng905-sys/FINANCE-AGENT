import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RetentionDataClass, RetentionRunStatus } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RetentionService } from '../../src/retention/retention.service';

describe('retention dry-run PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: RetentionService;
  let adminToken: string;
  let auditorToken: string;
  let financeToken: string;
  const previousMode = process.env.DATA_RETENTION_MODE;
  const previousRole = process.env.PROCESS_ROLE;

  beforeAll(async () => {
    process.env.DATA_RETENTION_MODE = 'dry-run';
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
    retention = app.get(RetentionService);
    await prisma.retentionLegalHold.deleteMany();
    await prisma.retentionRun.deleteMany();

    const login = async (username: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username, password: '123456' })
        .expect(200);
      return response.body.data.accessToken as string;
    };
    adminToken = await login('admin');
    auditorToken = await login('auditor');
    financeToken = await login('finance');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.retentionLegalHold.deleteMany();
      await prisma.retentionRun.deleteMany();
      await prisma.aiConversation.deleteMany({ where: { title: 'retention-integration-evidence' } });
    }
    if (app) await app.close();
    if (previousMode === undefined) delete process.env.DATA_RETENTION_MODE;
    else process.env.DATA_RETENTION_MODE = previousMode;
    if (previousRole === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = previousRole;
  });

  it('enforces admin/auditor boundaries for retention operations', async () => {
    await request(app.getHttpServer())
      .get('/api/retention/classes')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);

    const classes = await request(app.getHttpServer())
      .get('/api/retention/classes')
      .set('Authorization', `Bearer ${auditorToken}`)
      .expect(200);
    expect(classes.body.data).toMatchObject({
      mode: 'dry-run',
      destructiveExecutionEnabled: false,
      pendingDecisionRefs: ['H12', 'H14']
    });

    await request(app.getHttpServer())
      .post('/api/retention/runs')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({
        dataClass: RetentionDataClass.ai_conversation_content,
        cutoffAt: '2002-01-01T00:00:00.000Z',
        dryRun: true
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/retention/runs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dataClass: RetentionDataClass.ai_conversation_content,
        cutoffAt: '2002-01-01T00:00:00.000Z',
        dryRun: false
      })
      .expect(400);

    await expect(prisma.retentionRun.create({
      data: {
        dataClass: RetentionDataClass.notification,
        dryRun: false,
        cutoffAt: new Date('2002-01-01T00:00:00.000Z'),
        batchSize: 10
      }
    })).rejects.toThrow();
    await expect(prisma.retentionRun.create({
      data: {
        dataClass: RetentionDataClass.notification,
        dryRun: true,
        cutoffAt: new Date('2002-01-01T00:00:00.000Z'),
        batchSize: 10,
        deletedCount: 1
      }
    })).rejects.toThrow();
  });

  it('is lease-safe, legal-hold-aware, anonymous, non-destructive, and idempotent', async () => {
    const boss = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } });
    const conversation = await prisma.aiConversation.create({
      data: { ownerUserId: boss.id, title: 'retention-integration-evidence' }
    });
    const oldDate = new Date('2001-01-01T00:00:00.000Z');
    const [heldMessage, eligibleMessage] = await Promise.all([
      prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: 'sensitive-retention-secret-held',
          createdAt: oldDate
        }
      }),
      prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: 'sensitive-retention-secret-eligible',
          createdAt: oldDate
        }
      })
    ]);

    await request(app.getHttpServer())
      .post('/api/retention/legal-holds')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        resourceType: 'ai_message',
        resourceId: heldMessage.id,
        reason: 'Synthetic legal hold for retention integration test'
      })
      .expect(201);

    const queued = await request(app.getHttpServer())
      .post('/api/retention/runs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dataClass: RetentionDataClass.ai_conversation_content,
        cutoffAt: '2002-01-01T00:00:00.000Z',
        dryRun: true,
        batchSize: 10
      })
      .expect(201);
    const runId = queued.body.data.id as string;

    const outcomes = await Promise.all([
      retention.processNext('retention-instance-a'),
      retention.processNext('retention-instance-b')
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const completed = await prisma.retentionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(completed).toMatchObject({
      status: RetentionRunStatus.completed,
      dryRun: true,
      beforeCount: 2,
      afterCount: 2,
      scannedCount: 2,
      eligibleCount: 1,
      heldCount: 1,
      protectedCount: 0,
      deletedCount: 0,
      leaseToken: null,
      leaseUntil: null
    });
    const evidenceText = JSON.stringify(completed.evidence);
    expect(evidenceText).not.toContain(heldMessage.id);
    expect(evidenceText).not.toContain(eligibleMessage.id);
    expect(evidenceText).not.toContain('sensitive-retention-secret');
    expect(completed.evidence).toMatchObject({
      schemaVersion: 'retention-dry-run/1.0',
      destructiveAction: false,
      contentIncluded: false,
      candidateSampleHashes: [expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^[a-f0-9]{64}$/)]
    });
    await expect(prisma.aiMessage.count({ where: { conversationId: conversation.id } })).resolves.toBe(2);

    const completedAuditsBefore = await prisma.auditLog.count({
      where: { action: 'retention.dry_run.completed', resourceId: runId }
    });
    await expect(retention.processNext('retention-instance-replay')).resolves.toBeNull();
    const completedAuditsAfter = await prisma.auditLog.count({
      where: { action: 'retention.dry_run.completed', resourceId: runId }
    });
    expect(completedAuditsBefore).toBe(1);
    expect(completedAuditsAfter).toBe(1);
  });

  it('fails closed when an expired lease has exhausted its retry budget', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const run = await prisma.retentionRun.create({
      data: {
        dataClass: RetentionDataClass.notification,
        status: RetentionRunStatus.running,
        dryRun: true,
        cutoffAt: new Date('2002-01-01T00:00:00.000Z'),
        batchSize: 10,
        requestedBy: admin.id,
        requestedByUsername: admin.username,
        attemptCount: 3,
        maxAttempts: 3,
        leaseToken: 'expired-lease',
        leaseUntil: new Date(Date.now() - 60_000)
      }
    });

    await retention.processNext('retention-recovery-instance');
    const recovered = await prisma.retentionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(recovered).toMatchObject({
      status: RetentionRunStatus.failed,
      errorCode: 'RETENTION_MAX_ATTEMPTS_EXHAUSTED',
      deletedCount: 0,
      leaseToken: null,
      leaseUntil: null
    });
    await expect(prisma.auditLog.count({
      where: { action: 'retention.dry_run.lease_recovery_failed', resourceId: run.id }
    })).resolves.toBe(1);
  });
});
