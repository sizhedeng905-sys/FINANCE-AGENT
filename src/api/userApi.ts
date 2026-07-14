import { runtimeConfig } from '@/config/runtime';
import type {
  CreateUserPayload,
  PaginatedUsers,
  UpdateUserPayload,
  UserAccount,
  UserListQuery,
} from '@/types/user';
import { getAccessToken } from './authSession';
import { httpClient } from './httpClient';
import {
  mockCreateUser,
  mockDeleteUser,
  mockGetUser,
  mockListUsers,
  mockResetPassword,
  mockUpdateStatus,
  mockUpdateUser,
} from './mockIdentityRepository';

function createQueryString(query: UserListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

export function getUsers(query: UserListQuery = {}): Promise<PaginatedUsers> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedUsers>(`/users${createQueryString(query)}`)
    : mockListUsers(getAccessToken(), query);
}

export function createUser(payload: CreateUserPayload): Promise<UserAccount> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<UserAccount>('/users', payload)
    : mockCreateUser(getAccessToken(), payload);
}

export function getUser(id: string): Promise<UserAccount> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<UserAccount>(`/users/${encodeURIComponent(id)}`)
    : mockGetUser(getAccessToken(), id);
}

export function updateUser(id: string, payload: UpdateUserPayload): Promise<UserAccount> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<UserAccount>(`/users/${encodeURIComponent(id)}`, payload)
    : mockUpdateUser(getAccessToken(), id, payload);
}

export function resetUserPassword(id: string, newPassword: string): Promise<{ id: string }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<{ id: string }>(`/users/${encodeURIComponent(id)}/password`, { newPassword })
    : mockResetPassword(getAccessToken(), id, newPassword);
}

export function updateUserStatus(
  id: string,
  status: UserAccount['status'],
): Promise<{ id: string; status: UserAccount['status'] }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<{ id: string; status: UserAccount['status'] }>(`/users/${encodeURIComponent(id)}/status`, {
        status,
      })
    : mockUpdateStatus(getAccessToken(), id, status);
}

export function deleteUser(id: string): Promise<{ id: string; status: UserAccount['status'] }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.delete<{ id: string; status: UserAccount['status'] }>(`/users/${encodeURIComponent(id)}`)
    : mockDeleteUser(getAccessToken(), id);
}
