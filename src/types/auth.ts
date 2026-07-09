export type Role = 'employee' | 'finance' | 'reviewer' | 'boss';

export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  role: Role;
  title: string;
  department: string;
  avatarColor: string;
}
