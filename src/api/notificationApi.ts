import { mockNotifications } from '@/mock/mockNotifications';
import type { Role } from '@/types/auth';
import type { Notification } from '@/types/notification';

const delay = (ms = 160) => new Promise((resolve) => window.setTimeout(resolve, ms));

// GET /api/notifications?targetRole=:role
export async function fetchNotificationsApi(role: Role): Promise<Notification[]> {
  await delay();
  return mockNotifications.filter((item) => item.targetRole === role);
}

// POST /api/notifications
export async function createNotificationApi(notification: Notification): Promise<Notification> {
  await delay();
  return notification;
}

// PATCH /api/notifications/:id/read
export async function markNotificationReadApi(id: string): Promise<{ id: string; read: true }> {
  await delay();
  return { id, read: true };
}

// PATCH /api/notifications/read-all
export async function markAllNotificationsReadApi(role: Role): Promise<{ role: Role; read: true }> {
  await delay();
  return { role, read: true };
}
