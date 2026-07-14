import { create } from 'zustand';
import {
  createUser as createUserRequest,
  deleteUser as deleteUserRequest,
  getUsers,
  resetUserPassword,
  updateUser as updateUserRequest,
  updateUserStatus,
} from '@/api/userApi';
import type {
  CreateUserPayload,
  UpdateUserPayload,
  UserAccount,
  UserListQuery,
} from '@/types/user';

interface UserState {
  users: UserAccount[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  error: string | null;
  lastQuery: UserListQuery;
  fetchUsers: (query?: UserListQuery) => Promise<void>;
  createUser: (payload: CreateUserPayload) => Promise<UserAccount>;
  updateUser: (id: string, payload: UpdateUserPayload) => Promise<UserAccount>;
  resetPassword: (id: string, newPassword: string) => Promise<void>;
  updateStatus: (id: string, status: UserAccount['status']) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  clearUsers: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败';
}

async function refreshCurrentPage(get: () => UserState, page?: number): Promise<void> {
  try {
    await get().fetchUsers({ ...get().lastQuery, page: page ?? get().lastQuery.page });
  } catch {
    // The write already succeeded. fetchUsers keeps the refresh error visible.
  }
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  page: 1,
  pageSize: 20,
  total: 0,
  loading: false,
  error: null,
  lastQuery: { page: 1, pageSize: 20 },
  fetchUsers: async (query = get().lastQuery) => {
    const normalizedQuery = {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? get().pageSize,
      keyword: query.keyword,
      role: query.role,
      status: query.status,
    };
    set({ loading: true, error: null, lastQuery: normalizedQuery });
    try {
      const result = await getUsers(normalizedQuery);
      set({
        users: result.items,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  },
  createUser: async (payload) => {
    set({ error: null });
    try {
      const user = await createUserRequest(payload);
      await refreshCurrentPage(get, 1);
      return user;
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },
  updateUser: async (id, payload) => {
    set({ error: null });
    try {
      const user = await updateUserRequest(id, payload);
      await refreshCurrentPage(get);
      return user;
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },
  resetPassword: async (id, newPassword) => {
    set({ error: null });
    try {
      await resetUserPassword(id, newPassword);
      await refreshCurrentPage(get);
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },
  updateStatus: async (id, status) => {
    set({ error: null });
    try {
      await updateUserStatus(id, status);
      await refreshCurrentPage(get);
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },
  deleteUser: async (id) => {
    set({ error: null });
    try {
      await deleteUserRequest(id);
      await refreshCurrentPage(get);
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },
  clearUsers: () => set({ users: [], page: 1, total: 0, error: null }),
}));
