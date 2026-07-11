import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { toNotification } from './notification.presenter';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: QueryNotificationsDto, user: CurrentUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.NotificationWhereInput = {
      ...this.scope(user),
      read: query.read
    };
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...this.scope(user), read: false } })
    ]);
    return { items: items.map(toNotification), page, pageSize, total, unreadCount };
  }

  async markRead(id: string, user: CurrentUser) {
    const notification = await this.prisma.notification.findFirst({ where: { id, ...this.scope(user) } });
    if (!notification) throw new NotFoundException('资源不存在');
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { read: true, readAt: notification.readAt ?? new Date() }
    });
    return toNotification(updated);
  }

  async markAllRead(user: CurrentUser) {
    const result = await this.prisma.notification.updateMany({
      where: { ...this.scope(user), read: false },
      data: { read: true, readAt: new Date() }
    });
    return { updatedCount: result.count, unreadCount: 0 };
  }

  private scope(user: CurrentUser): Prisma.NotificationWhereInput {
    return {
      OR: [
        { targetUserId: user.id },
        { targetUserId: null, targetRole: user.role }
      ]
    };
  }
}
