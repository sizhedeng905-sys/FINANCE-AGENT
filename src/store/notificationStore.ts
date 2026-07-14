import { create } from 'zustand';
import {
  fetchNotificationsApi,
  markAllNotificationsReadApi,
  markNotificationReadApi,
} from '@/api/notificationApi';
import type { Notification, NotificationListQuery } from '@/types/notification';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '通知请求失败';

interface NotificationState {
  ownerUserId?: string;
  notifications: Notification[];
  unreadCount: number;
  total: number;
  loading: boolean;
  actionId?: string;
  error: string | null;
  fetchNotifications: (ownerUserId: string, query?: NotificationListQuery) => Promise<void>;
  markRead: (id: string) => Promise<Notification>;
  markAllRead: () => Promise<void>;
  reset: (ownerUserId?: string) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  ownerUserId: undefined,
  notifications: [],
  unreadCount: 0,
  total: 0,
  loading: false,
  actionId: undefined,
  error: null,
  fetchNotifications: async (ownerUserId, query = { page: 1, pageSize: 8 }) => {
    set((state) => ({
      ownerUserId,
      notifications: state.ownerUserId === ownerUserId ? state.notifications : [],
      unreadCount: state.ownerUserId === ownerUserId ? state.unreadCount : 0,
      loading: true,
      error: null,
    }));
    try {
      const result = await fetchNotificationsApi(query);
      if (get().ownerUserId !== ownerUserId) return;
      set({
        notifications: result.items,
        unreadCount: result.unreadCount,
        total: result.total,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (get().ownerUserId === ownerUserId) set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  },
  markRead: async (id) => {
    set({ actionId: id, error: null });
    try {
      const updated = await markNotificationReadApi(id);
      set((state) => ({
        notifications: state.notifications.map((item) => item.id === id ? updated : item),
        unreadCount: state.notifications.some((item) => item.id === id && !item.read)
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
        actionId: undefined,
      }));
      return updated;
    } catch (error) {
      set({ actionId: undefined, error: errorMessage(error) });
      throw error;
    }
  },
  markAllRead: async () => {
    set({ actionId: 'all', error: null });
    try {
      const result = await markAllNotificationsReadApi();
      const readAt = new Date().toISOString();
      set((state) => ({
        notifications: state.notifications.map((item) => item.read ? item : { ...item, read: true, readAt }),
        unreadCount: result.unreadCount,
        actionId: undefined,
      }));
    } catch (error) {
      set({ actionId: undefined, error: errorMessage(error) });
      throw error;
    }
  },
  reset: (ownerUserId) => set({
    ownerUserId,
    notifications: [],
    unreadCount: 0,
    total: 0,
    loading: false,
    actionId: undefined,
    error: null,
  }),
}));
