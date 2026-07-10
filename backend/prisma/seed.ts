import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('123456', 10);
  const users = [
    {
      username: '员工',
      name: '员工',
      role: 'employee' as const,
      department: '运营部',
      phone: '13800000001'
    },
    {
      username: '财务',
      name: '财务',
      role: 'finance' as const,
      department: '财务部',
      phone: '13800000002'
    },
    {
      username: '复核员',
      name: '复核员',
      role: 'reviewer' as const,
      department: '复核部',
      phone: '13800000003'
    },
    {
      username: '老板',
      name: '老板',
      role: 'boss' as const,
      department: '总经办',
      phone: '13800000004'
    },
    {
      username: 'employee',
      name: '员工',
      role: 'employee' as const,
      department: '运营部',
      phone: '13800000011'
    },
    {
      username: 'finance',
      name: '财务',
      role: 'finance' as const,
      department: '财务部',
      phone: '13800000012'
    },
    {
      username: 'reviewer',
      name: '复核员',
      role: 'reviewer' as const,
      department: '复核部',
      phone: '13800000013'
    },
    {
      username: 'boss',
      name: '老板',
      role: 'boss' as const,
      department: '总经办',
      phone: '13800000014'
    }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: {
        username: user.username
      },
      create: {
        ...user,
        passwordHash,
        status: 'active'
      },
      update: {
        name: user.name,
        role: user.role,
        department: user.department,
        phone: user.phone,
        passwordHash,
        status: 'active'
      }
    });
  }

  console.log('Phase 1 seed complete: auth test users are ready.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
