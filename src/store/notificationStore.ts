import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createNotificationApi,
  markAllNotificationsReadApi,
  markNotificationReadApi,
} from '@/api/notificationApi';
import { mockNotifications } from '@/mock/mockNotifications';
import type { Role } from '@/types/auth';
import type { Notification } from '@/types/notification';

interface NotificationState {
  notifications: Notification[];
  addNotification: (notification: Notification) => void;
  markRead: (id: string) => void;
  markAllRead: (role: Role) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: mockNotifications,
      addNotification: (notification) => {
        void createNotificationApi(notification);
        set((state) => ({ notifications: [notification, ...state.notifications] }));
      },
      markRead: (id) => {
        void markNotificationReadApi(id);
        set((state) => ({
          notifications: state.notifications.map((item) =>
            item.id === id ? { ...item, read: true } : item,
          ),
        }));
      },
      markAllRead: (role) => {
        void markAllNotificationsReadApi(role);
        set((state) => ({
          notifications: state.notifications.map((item) =>
            item.targetRole === role ? { ...item, read: true } : item,
          ),
        }));
      },
    }),
    {
      name: 'audit-notification-store-v3',
      partialize: (state) => ({ notifications: state.notifications }),
    },
  ),
);
