import { useUserStore } from '@/store/userStore';
import type { Role, User } from '@/types/auth';
import type { UserAccount } from '@/types/user';

const delay = (ms = 250) => new Promise((resolve) => window.setTimeout(resolve, ms));

const titleMap: Record<Role, string> = {
  employee: '员工',
  finance: '财务审核',
  reviewer: '复核员',
  boss: '老板',
};

const avatarColorMap: Record<Role, string> = {
  employee: '#1677ff',
  finance: '#13c2c2',
  reviewer: '#fa8c16',
  boss: '#722ed1',
};

function toAuthUser(account: UserAccount): User {
  return {
    id: account.id,
    username: account.username,
    password: account.password,
    name: account.name,
    role: account.role,
    title: titleMap[account.role],
    department: account.department,
    avatarColor: avatarColorMap[account.role],
  };
}

export async function loginApi(username: string, password: string): Promise<User> {
  await delay();
  const account = useUserStore.getState().users.find((item) => item.username === username && item.password === password);
  if (!account) {
    throw new Error('账号或密码错误');
  }
  if (account.status === 'disabled') {
    throw new Error('该账号已停用，请联系管理员。');
  }
  return toAuthUser(account);
}
