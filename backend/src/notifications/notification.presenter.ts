import { Notification } from '@prisma/client';

export function toNotification(notification: Notification) {
  return {
    id: notification.id,
    title: notification.title,
    content: notification.content,
    type: notification.type,
    sender: notification.senderName ?? '系统',
    targetRole: notification.targetRole ?? undefined,
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString(),
    relatedWorkOrderId: notification.relatedWorkOrderId ?? undefined,
    link: notification.relatedWorkOrderId ? `/work-orders/${notification.relatedWorkOrderId}` : undefined
  };
}
