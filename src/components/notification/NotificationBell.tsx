import { useEffect } from 'react';
import { BellOutlined } from '@ant-design/icons';
import { App, Badge, Button, Dropdown } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';
import NotificationDropdown from './NotificationDropdown';

export default function NotificationBell() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const ownerUserId = useNotificationStore((state) => state.ownerUserId);
  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loading = useNotificationStore((state) => state.loading);
  const actionId = useNotificationStore((state) => state.actionId);
  const error = useNotificationStore((state) => state.error);
  const fetchNotifications = useNotificationStore((state) => state.fetchNotifications);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const reset = useNotificationStore((state) => state.reset);

  useEffect(() => {
    if (!user) return;
    reset(user.id);
    const refresh = () => void fetchNotifications(user.id, { page: 1, pageSize: 8 }).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [fetchNotifications, reset, user?.id]);

  if (!user) return null;
  const isCurrentUser = ownerUserId === user.id;

  return (
    <Dropdown
      overlayClassName="notification-overlay"
      trigger={['click']}
      placement="bottomRight"
      onOpenChange={(open) => {
        if (open) void fetchNotifications(user.id, { page: 1, pageSize: 8 }).catch(() => undefined);
      }}
      dropdownRender={() => (
        <NotificationDropdown
          notifications={isCurrentUser ? notifications : []}
          unreadCount={isCurrentUser ? unreadCount : 0}
          loading={loading}
          actionId={actionId}
          error={error}
          onRead={async (id) => {
            try {
              await markRead(id);
            } catch (reason) {
              message.error(reason instanceof Error ? reason.message : '通知标记失败');
              throw reason;
            }
          }}
          onReadAll={async () => {
            try {
              await markAllRead();
            } catch (reason) {
              message.error(reason instanceof Error ? reason.message : '全部已读失败');
              throw reason;
            }
          }}
          onOpenWorkOrder={(id) => navigate(`/work-orders/${id}`)}
        />
      )}
    >
      <Badge count={isCurrentUser ? unreadCount : 0} size="small">
        <Button type="text" shape="circle" icon={<BellOutlined />} aria-label="通知" />
      </Badge>
    </Dropdown>
  );
}
