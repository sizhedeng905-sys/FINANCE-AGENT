import { useMemo } from 'react';
import { BellOutlined } from '@ant-design/icons';
import { Badge, Button, Dropdown } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@/types/auth';
import { useNotificationStore } from '@/store/notificationStore';
import NotificationDropdown from './NotificationDropdown';

export default function NotificationBell({ role }: { role: Role }) {
  const navigate = useNavigate();
  const allNotifications = useNotificationStore((state) => state.notifications);
  const notifications = useMemo(
    () => allNotifications.filter((item) => item.targetRole === role).slice(0, 8),
    [allNotifications, role],
  );
  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications],
  );
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      dropdownRender={() => (
        <NotificationDropdown
          notifications={notifications}
          onRead={markRead}
          onReadAll={() => markAllRead(role)}
          onOpenWorkOrder={(id) => navigate(`/work-orders/${id}`)}
        />
      )}
    >
      <Badge count={unreadCount} size="small">
        <Button type="text" shape="circle" icon={<BellOutlined />} aria-label="通知" />
      </Badge>
    </Dropdown>
  );
}
