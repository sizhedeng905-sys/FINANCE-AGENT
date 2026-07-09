import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserAccount } from '@/types/user';

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

const initialUsers: UserAccount[] = [
  {
    id: 'u-employee',
    username: 'employee',
    password: '123456',
    name: '员工张三',
    role: 'employee',
    department: '运营部',
    phone: '13800000001',
    status: 'active',
    createdAt: '2026-07-09 09:00',
    updatedAt: '2026-07-09 09:00',
    createdBy: '系统',
  },
  {
    id: 'u-finance',
    username: 'finance',
    password: '123456',
    name: '财务林雪',
    role: 'finance',
    department: '财务部',
    phone: '13800000002',
    status: 'active',
    createdAt: '2026-07-09 09:00',
    updatedAt: '2026-07-09 09:00',
    createdBy: '系统',
  },
  {
    id: 'u-reviewer',
    username: 'reviewer',
    password: '123456',
    name: '复核员赵明',
    role: 'reviewer',
    department: '内控部',
    phone: '13800000003',
    status: 'active',
    createdAt: '2026-07-09 09:00',
    updatedAt: '2026-07-09 09:00',
    createdBy: '系统',
  },
  {
    id: 'u-boss',
    username: 'boss',
    password: '123456',
    name: '老板',
    role: 'boss',
    department: '管理层',
    phone: '13800000004',
    status: 'active',
    createdAt: '2026-07-09 09:00',
    updatedAt: '2026-07-09 09:00',
    createdBy: '系统',
  },
];

export interface CreateUserPayload {
  username: string;
  password: string;
  name: string;
  role: UserAccount['role'];
  department: string;
  phone: string;
  createdBy?: string;
}

interface UserState {
  users: UserAccount[];
  getUsers: () => UserAccount[];
  createUser: (payload: CreateUserPayload) => UserAccount;
  updateUser: (id: string, payload: Partial<Omit<UserAccount, 'id' | 'username' | 'password' | 'createdAt' | 'createdBy'>>) => void;
  resetPassword: (id: string, newPassword: string) => void;
  disableUser: (id: string) => void;
  enableUser: (id: string) => void;
  deleteUser: (id: string) => void;
}

function assertCreatePayload(payload: CreateUserPayload, users: UserAccount[]) {
  if (!payload.username?.trim()) throw new Error('登录账号不能为空');
  if (!payload.password?.trim()) throw new Error('初始密码不能为空');
  if (!payload.name?.trim()) throw new Error('姓名不能为空');
  if (!payload.role) throw new Error('角色不能为空');
  if (users.some((item) => item.username === payload.username.trim())) {
    throw new Error('登录账号已存在');
  }
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      users: initialUsers,
      getUsers: () => get().users,
      createUser: (payload) => {
        assertCreatePayload(payload, get().users);
        const user: UserAccount = {
          id: `u-${Date.now()}`,
          username: payload.username.trim(),
          password: payload.password,
          name: payload.name.trim(),
          role: payload.role,
          department: payload.department?.trim() || '-',
          phone: payload.phone?.trim() || '-',
          status: 'active',
          createdAt: now(),
          updatedAt: now(),
          createdBy: payload.createdBy || '当前用户',
        };
        set((state) => ({ users: [user, ...state.users] }));
        return user;
      },
      updateUser: (id, payload) =>
        set((state) => ({
          users: state.users.map((item) => (item.id === id ? { ...item, ...payload, updatedAt: now() } : item)),
        })),
      resetPassword: (id, newPassword) => {
        if (!newPassword.trim()) throw new Error('新密码不能为空');
        set((state) => ({
          users: state.users.map((item) => (item.id === id ? { ...item, password: newPassword, updatedAt: now() } : item)),
        }));
      },
      disableUser: (id) =>
        set((state) => ({
          users: state.users.map((item) => (item.id === id ? { ...item, status: 'disabled', updatedAt: now() } : item)),
        })),
      enableUser: (id) =>
        set((state) => ({
          users: state.users.map((item) => (item.id === id ? { ...item, status: 'active', updatedAt: now() } : item)),
        })),
      deleteUser: (id) => set((state) => ({ users: state.users.filter((item) => item.id !== id) })),
    }),
    {
      name: 'audit-user-store-v1',
      partialize: (state) => ({ users: state.users }),
    },
  ),
);
