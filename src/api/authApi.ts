import { runtimeConfig } from '@/config/runtime';
import type { AuthSession, Role, User } from '@/types/auth';
import type { UserAccount } from '@/types/user';
import { getAccessToken } from './authSession';
import { httpClient } from './httpClient';
import { mockLogin, mockLogout, mockMe } from './mockIdentityRepository';

type AuthUserDto = Pick<User, 'id' | 'username' | 'name' | 'role' | 'department' | 'title'>;

const avatarColorMap: Record<Role, string> = {
  employee: '#1677ff',
  finance: '#13c2c2',
  reviewer: '#fa8c16',
  boss: '#722ed1',
};

function toAuthUser(user: AuthUserDto | UserAccount): User {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    title: user.title ?? user.role,
    department: user.department,
    avatarColor: avatarColorMap[user.role],
  };
}

export async function loginApi(username: string, password: string): Promise<AuthSession> {
  const session = runtimeConfig.dataMode === 'api'
    ? await httpClient.post<{ accessToken: string; user: AuthUserDto }>('/auth/login', { username, password })
    : await mockLogin(username, password);
  return { accessToken: session.accessToken, user: toAuthUser(session.user) };
}

export async function getCurrentUserApi(): Promise<User> {
  const user = runtimeConfig.dataMode === 'api'
    ? await httpClient.get<AuthUserDto>('/auth/me')
    : await mockMe(getAccessToken());
  return toAuthUser(user);
}

export async function logoutApi(): Promise<{ success: boolean }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<{ success: boolean }>('/auth/logout')
    : mockLogout(getAccessToken());
}
