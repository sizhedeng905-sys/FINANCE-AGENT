export type Role = 'employee' | 'finance' | 'reviewer' | 'boss';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  title: string;
  department: string;
  avatarColor: string;
}

export interface AuthSession {
  accessToken: string;
  user: User;
}
