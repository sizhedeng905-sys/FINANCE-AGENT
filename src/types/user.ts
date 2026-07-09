import type { Role } from './auth';

export type UserRole = Role;

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  department: string;
  phone: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
