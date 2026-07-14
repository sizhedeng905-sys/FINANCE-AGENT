import type { Role } from './auth';

export type NotificationType = 'urgent' | 'audit' | 'system' | 'boss_approval';

export interface Notification {
  id: string;
  title: string;
  content: string;
  type: NotificationType;
  sender: string;
  targetRole?: Role;
  targetUserId?: string;
  read: boolean;
  createdAt: string;
  readAt?: string;
  relatedWorkOrderId?: string;
  link?: string;
}

export interface NotificationListQuery {
  page?: number;
  pageSize?: number;
  read?: boolean;
}

export interface PaginatedNotifications {
  items: Notification[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}

export interface MarkAllNotificationsReadResult {
  updatedCount: number;
  unreadCount: number;
}
