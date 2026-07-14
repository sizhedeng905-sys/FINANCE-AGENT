import { mockUsers } from '@/mock/mockUsers';
import type { Role } from '@/types/auth';
import type {
  CreateUserPayload,
  PaginatedUsers,
  UpdateUserPayload,
  UserAccount,
  UserListQuery,
} from '@/types/user';

const mockDelay = (ms = 160) => new Promise((resolve) => window.setTimeout(resolve, ms));

let users = mockUsers.map((user) => ({ ...user }));
const passwords = new Map(users.map((user) => [user.username, '123456']));
const tokenVersions = new Map(users.map((user) => [user.id, 0]));
const revokedTokens = new Set<string>();

const chineseAliases: Record<string, string> = {
  员工: 'employee',
  财务: 'finance',
  复核员: 'reviewer',
  老板: 'boss',
};

const titleMap: Record<Role, string> = {
  employee: '员工',
  finance: '财务审核',
  reviewer: '复核员',
  boss: '老板',
};

function cloneUser(user: UserAccount): UserAccount {
  return { ...user };
}

function findUserOrThrow(id: string): UserAccount {
  const user = users.find((item) => item.id === id);
  if (!user) throw new Error('资源不存在');
  return user;
}

function parseToken(token: string): { userId: string; version: number } | null {
  if (revokedTokens.has(token)) return null;
  const [prefix, userId, rawVersion] = token.split(':');
  const version = Number(rawVersion);
  if (prefix !== 'mock' || !userId || !Number.isInteger(version)) return null;
  return { userId, version };
}

function currentUser(token: string | null): UserAccount {
  if (!token) throw new Error('未登录');
  const payload = parseToken(token);
  if (!payload) throw new Error('登录状态已失效');
  const user = findUserOrThrow(payload.userId);
  if (user.status !== 'active' || tokenVersions.get(user.id) !== payload.version) {
    throw new Error('登录状态已失效');
  }
  return user;
}

function requireManager(token: string | null): UserAccount {
  const actor = currentUser(token);
  if (actor.role !== 'finance' && actor.role !== 'boss') throw new Error('无权限');
  return actor;
}

function assertFinanceBoundary(actor: UserAccount, target?: UserAccount, requestedRole?: Role): void {
  if (actor.role === 'finance' && (target?.role === 'boss' || requestedRole === 'boss')) {
    throw new Error('财务角色不能创建、提升或操作老板账号');
  }
}

function assertNotLastBoss(target: UserAccount, nextRole = target.role, nextStatus = target.status): void {
  const removesActiveBoss = target.role === 'boss' && target.status === 'active' && (nextRole !== 'boss' || nextStatus !== 'active');
  if (!removesActiveBoss) return;
  const otherActiveBosses = users.filter(
    (user) => user.id !== target.id && user.role === 'boss' && user.status === 'active',
  );
  if (otherActiveBosses.length === 0) throw new Error('不能停用、降级或删除最后一个有效老板账号');
}

function incrementTokenVersion(userId: string): void {
  tokenVersions.set(userId, (tokenVersions.get(userId) ?? 0) + 1);
}

export async function mockLogin(username: string, password: string) {
  await mockDelay();
  const canonicalUsername = chineseAliases[username] ?? username;
  const user = users.find((item) => item.username === canonicalUsername);
  if (!user || passwords.get(user.username) !== password || user.status !== 'active') {
    throw new Error('账号或密码错误');
  }
  const version = tokenVersions.get(user.id) ?? 0;
  return {
    accessToken: `mock:${user.id}:${version}:${Date.now()}`,
    user: cloneUser(user),
  };
}

export async function mockMe(token: string | null): Promise<UserAccount> {
  await mockDelay(80);
  return cloneUser(currentUser(token));
}

export async function mockLogout(token: string | null): Promise<{ success: true }> {
  await mockDelay(80);
  if (token) {
    const payload = parseToken(token);
    if (payload) incrementTokenVersion(payload.userId);
    revokedTokens.add(token);
  }
  return { success: true };
}

export async function mockListUsers(token: string | null, query: UserListQuery): Promise<PaginatedUsers> {
  await mockDelay();
  requireManager(token);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const keyword = query.keyword?.trim().toLowerCase();
  const filtered = users.filter((user) => {
    if (query.role && user.role !== query.role) return false;
    if (query.status && user.status !== query.status) return false;
    if (!keyword) return true;
    return [user.username, user.name, user.department, user.phone].some((value) => value.toLowerCase().includes(keyword));
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(cloneUser),
    page,
    pageSize,
    total: filtered.length,
  };
}

export async function mockGetUser(token: string | null, id: string): Promise<UserAccount> {
  await mockDelay();
  requireManager(token);
  return cloneUser(findUserOrThrow(id));
}

export async function mockCreateUser(token: string | null, payload: CreateUserPayload): Promise<UserAccount> {
  await mockDelay();
  const actor = requireManager(token);
  assertFinanceBoundary(actor, undefined, payload.role);
  const username = payload.username.trim();
  if (users.some((user) => user.username === username)) throw new Error('登录账号已存在');
  const now = new Date().toISOString();
  const user: UserAccount = {
    id: `mock-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    name: payload.name.trim(),
    role: payload.role,
    department: payload.department?.trim() ?? '',
    phone: payload.phone?.trim() ?? '',
    status: payload.status ?? 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
    title: titleMap[payload.role],
  };
  users = [user, ...users];
  passwords.set(user.username, payload.password);
  tokenVersions.set(user.id, 0);
  return cloneUser(user);
}

export async function mockUpdateUser(
  token: string | null,
  id: string,
  payload: UpdateUserPayload,
): Promise<UserAccount> {
  await mockDelay();
  const actor = requireManager(token);
  const target = findUserOrThrow(id);
  const previousUsername = target.username;
  assertFinanceBoundary(actor, target, payload.role);
  if (payload.username && users.some((user) => user.id !== id && user.username === payload.username)) {
    throw new Error('登录账号已存在');
  }
  assertNotLastBoss(target, payload.role ?? target.role, target.status);
  const roleChanged = payload.role !== undefined && payload.role !== target.role;
  Object.assign(target, payload, {
    title: titleMap[payload.role ?? target.role],
    updatedAt: new Date().toISOString(),
  });
  if (target.username !== previousUsername) {
    const password = passwords.get(previousUsername);
    passwords.delete(previousUsername);
    if (password !== undefined) passwords.set(target.username, password);
  }
  if (roleChanged) incrementTokenVersion(target.id);
  return cloneUser(target);
}

export async function mockResetPassword(token: string | null, id: string, newPassword: string): Promise<{ id: string }> {
  await mockDelay();
  const actor = requireManager(token);
  const target = findUserOrThrow(id);
  assertFinanceBoundary(actor, target);
  passwords.set(target.username, newPassword);
  incrementTokenVersion(target.id);
  target.updatedAt = new Date().toISOString();
  return { id };
}

export async function mockUpdateStatus(
  token: string | null,
  id: string,
  status: UserAccount['status'],
): Promise<{ id: string; status: UserAccount['status'] }> {
  await mockDelay();
  const actor = requireManager(token);
  const target = findUserOrThrow(id);
  assertFinanceBoundary(actor, target);
  assertNotLastBoss(target, target.role, status);
  target.status = status;
  target.updatedAt = new Date().toISOString();
  incrementTokenVersion(target.id);
  return { id, status };
}

export async function mockDeleteUser(token: string | null, id: string): Promise<{ id: string; status: 'disabled' }> {
  const result = await mockUpdateStatus(token, id, 'disabled');
  return { id: result.id, status: 'disabled' };
}
