import { Empty, List, Space, Tag, Typography, Button } from 'antd';
import type { Notification } from '@/types/notification';

const typeColorMap: Record<Notification['type'], string> = {
  urgent: 'error',
  audit: 'processing',
  system: 'default',
  boss_approval: 'warning',
};

const typeLabelMap: Record<Notification['type'], string> = {
  urgent: '催办',
  audit: '审核',
  system: '系统',
  boss_approval: '老板审批',
};

interface NotificationDropdownProps {
  notifications: Notification[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onOpenWorkOrder: (id: string) => void;
}

export default function NotificationDropdown({
  notifications,
  onRead,
  onReadAll,
  onOpenWorkOrder,
}: NotificationDropdownProps) {
  return (
    <div className="notification-panel">
      <div className="notification-head">
        <Typography.Text strong>最近通知</Typography.Text>
        <Button size="small" type="link" onClick={onReadAll}>
          全部已读
        </Button>
      </div>
      {notifications.length ? (
        <List
          dataSource={notifications}
          renderItem={(item) => (
            <List.Item
              className={item.read ? 'notification-item' : 'notification-item unread'}
              onClick={() => {
                onRead(item.id);
                if (item.relatedWorkOrderId) {
                  onOpenWorkOrder(item.relatedWorkOrderId);
                }
              }}
            >
              <Space direction="vertical" size={4} className="full-width">
                <Space className="card-row-between">
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <Tag color={typeColorMap[item.type]}>{typeLabelMap[item.type]}</Tag>
                </Space>
                <Typography.Text>{item.content}</Typography.Text>
                <Typography.Text type="secondary">
                  {item.sender} · {item.createdAt}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
      )}
    </div>
  );
}
