import dayjs from 'dayjs';
import { Alert, Button, Empty, List, Space, Spin, Tag, Typography } from 'antd';
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
  unreadCount: number;
  loading: boolean;
  actionId?: string;
  error: string | null;
  onRead: (id: string) => Promise<void>;
  onReadAll: () => Promise<void>;
  onOpenWorkOrder: (id: string) => void;
}

function displayTime(value: string): string {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MM-DD HH:mm') : value;
}

export default function NotificationDropdown({
  notifications,
  unreadCount,
  loading,
  actionId,
  error,
  onRead,
  onReadAll,
  onOpenWorkOrder,
}: NotificationDropdownProps) {
  return (
    <div className="notification-panel">
      <div className="notification-head">
        <Typography.Text strong>最近通知{unreadCount ? `（${unreadCount} 未读）` : ''}</Typography.Text>
        <Button
          size="small"
          type="link"
          disabled={unreadCount === 0}
          loading={actionId === 'all'}
          onClick={() => void onReadAll().catch(() => undefined)}
        >
          全部已读
        </Button>
      </div>
      {error ? <Alert className="notification-error" type="error" showIcon message="通知加载失败" description={error} /> : null}
      <Spin spinning={loading}>
        {notifications.length ? (
          <List
            dataSource={notifications}
            renderItem={(item) => (
              <List.Item
                className={item.read ? 'notification-item' : 'notification-item unread'}
                aria-busy={actionId === item.id}
                onClick={() => void onRead(item.id)
                  .then(() => {
                    if (item.relatedWorkOrderId) onOpenWorkOrder(item.relatedWorkOrderId);
                  })
                  .catch(() => undefined)}
              >
                <Space direction="vertical" size={4} className="full-width">
                  <Space className="card-row-between">
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Tag color={typeColorMap[item.type]}>{typeLabelMap[item.type]}</Tag>
                  </Space>
                  <Typography.Text>{item.content}</Typography.Text>
                  <Typography.Text type="secondary">
                    {item.sender} · {displayTime(item.createdAt)}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中' : '暂无通知'} />
        )}
      </Spin>
    </div>
  );
}
