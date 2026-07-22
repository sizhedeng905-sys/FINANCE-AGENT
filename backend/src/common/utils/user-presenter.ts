import { User, UserRole } from '@prisma/client';

const titleMap: Record<UserRole, string> = {
  employee: '员工',
  finance: '财务审核',
  reviewer: '复核员',
  boss: '老板',
  admin: '系统管理员',
  auditor: '安全审计员'
};

export function getRoleTitle(role: UserRole): string {
  return titleMap[role];
}

export function toPublicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    department: user.department ?? '',
    phone: user.phone ?? '',
    status: user.status,
    createdBy: user.createdBy ?? '',
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    title: getRoleTitle(user.role)
  };
}

export function toAuthUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    department: user.department ?? '',
    title: getRoleTitle(user.role)
  };
}
