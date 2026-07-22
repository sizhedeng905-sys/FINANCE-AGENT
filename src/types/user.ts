import type { Role } from './auth';

export type UserRole = Role;

export interface UserAccount {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  department: string;
  phone: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  title?: string;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  name: string;
  role: UserRole;
  department?: string;
  phone?: string;
  status?: UserAccount['status'];
}

export type UpdateUserPayload = Partial<Pick<UserAccount, 'username' | 'name' | 'role' | 'department' | 'phone'>>;

export interface UserListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  role?: UserRole;
  status?: UserAccount['status'];
}

export interface PaginatedUsers {
  items: UserAccount[];
  page: number;
  pageSize: number;
  total: number;
}
