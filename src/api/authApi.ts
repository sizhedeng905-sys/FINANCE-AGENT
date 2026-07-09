import { mockUsers } from '@/mock/mockUsers';
import type { Role, User } from '@/types/auth';

const delay = (ms = 250) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function loginApi(username: Role, password: string): Promise<User> {
  await delay();
  const user = mockUsers.find((item) => item.username === username && item.password === password);
  if (!user) {
    throw new Error('账号或密码错误');
  }
  return user;
}
