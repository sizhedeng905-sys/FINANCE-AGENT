import { runtimeConfig } from '@/config/runtime';
import type {
  MarkAllNotificationsReadResult,
  Notification,
  NotificationListQuery,
  PaginatedNotifications,
} from '@/types/notification';
import { httpClient } from './httpClient';
import {
  mockFetchNotifications,
  mockMarkAllNotificationsRead,
  mockMarkNotificationRead,
} from './mockNotificationRepository';

function queryString(query: NotificationListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function fetchNotificationsApi(query: NotificationListQuery = {}): Promise<PaginatedNotifications> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedNotifications>(`/notifications${queryString(query)}`)
    : mockFetchNotifications(query);
}

export function markNotificationReadApi(id: string): Promise<Notification> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<Notification>(`/notifications/${encodeURIComponent(id)}/read`)
    : mockMarkNotificationRead(id);
}

export function markAllNotificationsReadApi(): Promise<MarkAllNotificationsReadResult> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<MarkAllNotificationsReadResult>('/notifications/read-all')
    : mockMarkAllNotificationsRead();
}
