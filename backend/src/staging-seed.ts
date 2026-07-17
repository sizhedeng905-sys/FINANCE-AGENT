import 'reflect-metadata';

import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { readFile } from 'node:fs/promises';

const prisma = new PrismaClient();

const users = [
  { username: 'uat-employee', name: 'UAT 员工', role: UserRole.employee, department: 'UAT 业务' },
  { username: 'uat-finance', name: 'UAT 财务', role: UserRole.finance, department: 'UAT 财务' },
  { username: 'uat-reviewer', name: 'UAT 复核员', role: UserRole.reviewer, department: 'UAT 复核' },
  { username: 'uat-boss', name: 'UAT 老板', role: UserRole.boss, department: 'UAT 管理' }
];

async function main() {
  if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_STAGING_SEED !== 'true') {
    throw new Error('Synthetic staging seed requires NODE_ENV=production and ALLOW_STAGING_SEED=true');
  }
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (databaseUrl.pathname !== '/finance_agent_staging') {
    throw new Error('Synthetic staging seed only accepts the finance_agent_staging database');
  }
  const passwordFile = process.env.STAGING_SEED_PASSWORD_FILE;
  if (!passwordFile) throw new Error('STAGING_SEED_PASSWORD_FILE is required');
  const password = (await readFile(passwordFile, 'utf8')).trim();
  if (password.length < 24) throw new Error('Synthetic staging seed password is too short');
  const passwordHash = await hash(password, 12);
  let created = 0;
  for (const user of users) {
    const existing = await prisma.user.findUnique({ where: { username: user.username }, select: { id: true } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        ...user,
        passwordHash,
        phone: '',
        status: UserStatus.active
      }
    });
    created += 1;
  }
  if (created > 0) {
    await prisma.auditLog.create({
      data: {
        action: 'staging.synthetic_seed',
        resourceType: 'user',
        metadata: { created, usernames: users.map((user) => user.username) }
      }
    });
  }
  process.stdout.write(JSON.stringify({ status: 'ok', created, existing: users.length - created }) + '\n');
}

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Synthetic staging seed failed'}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
