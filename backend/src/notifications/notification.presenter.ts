import { Notification } from '@prisma/client';

export function toNotification(notification: Notification, readAt?: Date) {
  return {
    id: notification.id,
    title: notification.title,
    content: notification.content,
    type: notification.type,
    sender: notification.senderName ?? '系统',
    targetRole: notification.targetRole ?? undefined,
    targetUserId: notification.targetUserId ?? undefined,
    read: Boolean(readAt),
    createdAt: notification.createdAt.toISOString(),
    readAt: readAt?.toISOString(),
    relatedWorkOrderId: notification.relatedWorkOrderId ?? undefined,
    link: notification.relatedWorkOrderId ? `/work-orders/${notification.relatedWorkOrderId}` : undefined
  };
}
