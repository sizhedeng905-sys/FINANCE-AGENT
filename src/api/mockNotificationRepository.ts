import { getAccessToken } from './authSession';
import { mockMe } from './mockIdentityRepository';
import { mockNotifications } from '@/mock/mockNotifications';
import type {
  MarkAllNotificationsReadResult,
  Notification,
  NotificationListQuery,
  PaginatedNotifications,
} from '@/types/notification';

const delay = (ms = 120) => new Promise((resolve) => window.setTimeout(resolve, ms));
const notifications = mockNotifications.map((item) => ({ ...item }));
const readByUser = new Map<string, Set<string>>();

function readSet(notificationId: string): Set<string> {
  const existing = readByUser.get(notificationId);
  if (existing) return existing;
  const created = new Set<string>();
  readByUser.set(notificationId, created);
  return created;
}

export function mockPushNotification(
  input: Omit<Notification, 'id' | 'read' | 'createdAt'>,
): Notification {
  const notification: Notification = {
    ...input,
    id: `mock-notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    read: false,
    createdAt: new Date().toISOString(),
  };
  notifications.unshift(notification);
  return { ...notification };
}

function scoped(notification: Notification, user: Awaited<ReturnType<typeof mockMe>>): boolean {
  return notification.targetUserId === user.id || (!notification.targetUserId && notification.targetRole === user.role);
}

function present(notification: Notification, userId: string): Notification {
  const read = notification.read || readSet(notification.id).has(userId);
  return {
    ...notification,
    read,
    readAt: read ? notification.readAt ?? new Date().toISOString() : undefined,
  };
}

export async function mockFetchNotifications(query: NotificationListQuery = {}): Promise<PaginatedNotifications> {
  await delay();
  const user = await mockMe(getAccessToken());
  const visible = notifications.filter((item) => scoped(item, user));
  const presented = visible.map((item) => present(item, user.id));
  const filtered = query.read === undefined ? presented : presented.filter((item) => item.read === query.read);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total: filtered.length,
    unreadCount: presented.filter((item) => !item.read).length,
  };
}

export async function mockMarkNotificationRead(id: string): Promise<Notification> {
  await delay();
  const user = await mockMe(getAccessToken());
  const notification = notifications.find((item) => item.id === id && scoped(item, user));
  if (!notification) throw new Error('资源不存在');
  readSet(id).add(user.id);
  return present(notification, user.id);
}

export async function mockMarkAllNotificationsRead(): Promise<MarkAllNotificationsReadResult> {
  await delay();
  const user = await mockMe(getAccessToken());
  let updatedCount = 0;
  notifications.filter((item) => scoped(item, user)).forEach((item) => {
    const set = readSet(item.id);
    if (!item.read && !set.has(user.id)) {
      set.add(user.id);
      updatedCount += 1;
    }
  });
  return { updatedCount, unreadCount: 0 };
}
