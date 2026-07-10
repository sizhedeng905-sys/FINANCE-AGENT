import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  department: string | null;
  phone: string | null;
  status: UserStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

class InMemoryPrisma {
  users: UserRecord[] = [];
  auditLogs: Array<Record<string, unknown>> = [];
  private userCounter = 0;
  private auditCounter = 0;

  user = {
    findUnique: async ({ where }: { where: { id?: string; username?: string } }) =>
      this.users.find((user) => user.id === where.id || user.username === where.username) ?? null,
    findMany: async ({ where, skip = 0, take = 20 }: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      this.applyUserWhere(where)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
        .slice(skip, skip + take),
    count: async ({ where }: { where?: Record<string, unknown> }) => this.applyUserWhere(where).length,
    create: async ({ data }: { data: Partial<UserRecord> & { passwordHash: string; username: string; name: string; role: UserRole } }) => {
      if (this.users.some((user) => user.username === data.username)) {
        throw { code: 'P2002', meta: { target: ['username'] } };
      }

      const now = new Date();
      const user: UserRecord = {
        id: `user_${++this.userCounter}`,
        username: data.username,
        passwordHash: data.passwordHash,
        name: data.name,
        role: data.role,
        department: data.department ?? null,
        phone: data.phone ?? null,
        status: data.status ?? UserStatus.active,
        createdBy: data.createdBy ?? null,
        createdAt: now,
        updatedAt: now
      };

      this.users.push(user);
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRecord> }) => {
      const user = this.users.find((item) => item.id === where.id);
      if (!user) {
        throw new Error('User not found');
      }

      if (data.username && this.users.some((item) => item.id !== where.id && item.username === data.username)) {
        throw { code: 'P2002', meta: { target: ['username'] } };
      }

      Object.assign(user, data, { updatedAt: new Date() });
      return user;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = this.users.findIndex((item) => item.id === where.id);
      if (index < 0) {
        throw new Error('User not found');
      }

      const [deleted] = this.users.splice(index, 1);
      return deleted;
    }
  };

  auditLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const log = {
        id: `audit_${++this.auditCounter}`,
        ...data,
        createdAt: new Date()
      };
      this.auditLogs.push(log);
      return log;
    }
  };

  async $transaction<T>(callback: (tx: this) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async $disconnect() {
    return undefined;
  }

  async seed() {
    const passwordHash = await bcrypt.hash('123456', 10);
    const accounts: Array<Pick<UserRecord, 'username' | 'name' | 'role' | 'department' | 'phone'>> = [
      { username: '员工', name: '员工', role: UserRole.employee, department: '运营部', phone: '13800000001' },
      { username: '财务', name: '财务', role: UserRole.finance, department: '财务部', phone: '13800000002' },
      { username: '复核员', name: '复核员', role: UserRole.reviewer, department: '复核部', phone: '13800000003' },
      { username: '老板', name: '老板', role: UserRole.boss, department: '总经办', phone: '13800000004' },
      { username: 'employee', name: '员工', role: UserRole.employee, department: '运营部', phone: '13800000011' },
      { username: 'finance', name: '财务', role: UserRole.finance, department: '财务部', phone: '13800000012' },
      { username: 'reviewer', name: '复核员', role: UserRole.reviewer, department: '复核部', phone: '13800000013' },
      { username: 'boss', name: '老板', role: UserRole.boss, department: '总经办', phone: '13800000014' }
    ];

    for (const account of accounts) {
      await this.user.create({
        data: {
          ...account,
          passwordHash,
          status: UserStatus.active,
          createdBy: null
        }
      });
    }
  }

  private applyUserWhere(where?: Record<string, unknown>) {
    let users = [...this.users];

    if (!where) {
      return users;
    }

    if (where.role) {
      users = users.filter((user) => user.role === where.role);
    }

    if (where.status) {
      users = users.filter((user) => user.status === where.status);
    }

    const or = where.OR as Array<Record<string, { contains: string }>> | undefined;
    if (or?.length) {
      users = users.filter((user) =>
        or.some((condition) =>
          Object.entries(condition).some(([key, value]) => {
            const source = String(user[key as keyof UserRecord] ?? '').toLowerCase();
            return source.includes(value.contains.toLowerCase());
          })
        )
      );
    }

    return users;
  }
}

describe('FINANCE-AGENT backend phase 1', () => {
  let app: INestApplication;
  let prisma: InMemoryPrisma;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    prisma = new InMemoryPrisma();
    await prisma.seed();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true
        }
      })
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(username: string, password = '123456') {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password })
      .expect(200);

    return response.body.data.accessToken as string;
  }

  it('GET /api/health returns the unified success envelope', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({
        code: 0,
        message: 'success',
        data: {
          status: 'ok'
        }
      });
  });

  it('GET /api/not-found returns the unified error envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/not-found').expect(404);

    expect(response.body).toEqual({
      code: 40401,
      message: '资源不存在',
      data: {}
    });
  });

  it('allows all seeded Chinese and English accounts to login', async () => {
    for (const username of ['员工', '财务', '复核员', '老板', 'employee', 'finance', 'reviewer', 'boss']) {
      const token = await login(username);
      expect(token).toEqual(expect.any(String));
    }
  });

  it('returns unified 401 for wrong credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: 'wrong-password' })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 40101,
      message: '账号或密码错误',
      data: {}
    });
  });

  it('returns the current user from GET /api/auth/me', async () => {
    const token = await login('finance');
    const response = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);

    expect(response.body.data).toMatchObject({
      username: 'finance',
      role: UserRole.finance,
      title: '财务审核'
    });
  });

  it('protects user management with auth and role guards', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);

    const employeeToken = await login('employee');
    await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${employeeToken}`).expect(403);

    const reviewerToken = await login('reviewer');
    await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${reviewerToken}`).expect(403);
  });

  it('allows finance and boss to manage users and writes audit logs', async () => {
    const financeToken = await login('finance');
    const bossToken = await login('boss');

    const financeCreateResponse = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        username: 'api_employee',
        password: '123456',
        name: '接口员工',
        role: UserRole.employee,
        department: '运营部',
        phone: '13900000001'
      })
      .expect(201);

    const createdUserId = financeCreateResponse.body.data.id as string;
    const createdUser = prisma.users.find((user) => user.id === createdUserId);
    expect(createdUser?.passwordHash).not.toBe('123456');
    expect(createdUser?.passwordHash).toMatch(/^\$2[aby]\$/);

    const bossCreateResponse = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        username: 'boss_employee',
        password: '123456',
        name: '老板新增员工',
        role: UserRole.employee,
        department: '运营部',
        phone: '13900000002'
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/users/${createdUserId}/password`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ newPassword: '654321' })
      .expect(200);

    await login('api_employee', '654321');

    await request(app.getHttpServer())
      .patch(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ name: '接口员工已更新' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: UserStatus.disabled })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'api_employee', password: '654321' })
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/api/users/${bossCreateResponse.body.data.id}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);

    const actions = prisma.auditLogs.map((log) => log.action);
    expect(actions).toEqual(
      expect.arrayContaining(['user.create', 'user.password.reset', 'user.update', 'user.status.update', 'user.delete'])
    );
  });

  it('returns a paginated users list for finance', async () => {
    const financeToken = await login('finance');
    const response = await request(app.getHttpServer())
      .get('/api/users?page=1&pageSize=5')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      page: 1,
      pageSize: 5
    });
    expect(response.body.data.items).toHaveLength(5);
    expect(response.body.data.total).toBeGreaterThanOrEqual(8);
  });
});
