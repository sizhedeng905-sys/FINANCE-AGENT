import { useUserStore, type CreateUserPayload } from '@/store/userStore';
import type { ApiResponse } from '@/types/dataCenter';
import type { UserAccount } from '@/types/user';

const delay = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));
const ok = <T,>(data: T, message = 'success'): ApiResponse<T> => ({ code: 0, message, data });

// GET /api/users
export async function getUsers(): Promise<ApiResponse<UserAccount[]>> {
  await delay();
  return ok(useUserStore.getState().users);
}

// POST /api/users
export async function createUser(payload: CreateUserPayload): Promise<ApiResponse<UserAccount>> {
  await delay();
  return ok(useUserStore.getState().createUser(payload), '员工已创建');
}

// GET /api/users/:id
export async function getUser(id: string): Promise<ApiResponse<UserAccount | undefined>> {
  await delay();
  return ok(useUserStore.getState().users.find((item) => item.id === id));
}

// PATCH /api/users/:id
export async function updateUser(id: string, payload: Partial<UserAccount>): Promise<ApiResponse<{ id: string }>> {
  await delay();
  useUserStore.getState().updateUser(id, payload);
  return ok({ id }, '员工信息已更新');
}

// PATCH /api/users/:id/password
export async function resetUserPassword(id: string, newPassword: string): Promise<ApiResponse<{ id: string }>> {
  await delay();
  useUserStore.getState().resetPassword(id, newPassword);
  return ok({ id }, '密码已重置');
}

// PATCH /api/users/:id/status
export async function updateUserStatus(
  id: string,
  status: UserAccount['status'],
): Promise<ApiResponse<{ id: string; status: UserAccount['status'] }>> {
  await delay();
  if (status === 'active') {
    useUserStore.getState().enableUser(id);
  } else {
    useUserStore.getState().disableUser(id);
  }
  return ok({ id, status }, '账号状态已更新');
}

// DELETE /api/users/:id
export async function deleteUser(id: string): Promise<ApiResponse<{ id: string }>> {
  await delay();
  useUserStore.getState().deleteUser(id);
  return ok({ id }, '员工已删除');
}
