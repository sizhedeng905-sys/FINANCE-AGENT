import type { Role } from './auth';

export type NotificationType = 'urgent' | 'audit' | 'system' | 'boss_approval';

export interface Notification {
  id: string;
  title: string;
  content: string;
  type: NotificationType;
  sender: string;
  targetRole: Role;
  read: boolean;
  createdAt: string;
  relatedWorkOrderId?: string;
}
