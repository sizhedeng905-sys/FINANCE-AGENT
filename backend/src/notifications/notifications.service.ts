import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { toNotification } from './notification.presenter';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async findMany(query: QueryNotificationsDto, user: CurrentUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.scopedWhere(user, query.read);
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: { receipts: { where: { userId: user.id }, select: { readAt: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: this.scopedWhere(user, false) })
    ]);
    return {
      items: items.map((item) => toNotification(item, item.receipts[0]?.readAt)),
      page,
      pageSize,
      total,
      unreadCount
    };
  }

  async markRead(id: string, user: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${id}:${user.id}`}, 2))`;
      const notification = await tx.notification.findFirst({
        where: { id, ...this.scope(user) },
        include: { receipts: { where: { userId: user.id }, select: { readAt: true } } }
      });
      if (!notification) throw new NotFoundException('资源不存在');
      const existingReadAt = notification.receipts[0]?.readAt;
      if (existingReadAt) return toNotification(notification, existingReadAt);
      const receipt = await tx.notificationReceipt.create({
        data: { notificationId: id, userId: user.id }
      });
      await this.auditLogs.write(
        tx,
        user,
        'notification.read',
        'notification',
        id,
        { readAt: receipt.readAt.toISOString() },
        context
      );
      return toNotification(notification, receipt.readAt);
    });
  }

  async markAllRead(user: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const unread = await tx.notification.findMany({
        where: this.scopedWhere(user, false),
        select: { id: true }
      });
      if (!unread.length) return { updatedCount: 0, unreadCount: 0 };
      const result = await tx.notificationReceipt.createMany({
        data: unread.map((notification) => ({ notificationId: notification.id, userId: user.id })),
        skipDuplicates: true
      });
      if (result.count > 0) {
        await this.auditLogs.write(
          tx,
          user,
          'notification.read_all',
          'notification',
          null,
          { updatedCount: result.count },
          context
        );
      }
      return { updatedCount: result.count, unreadCount: 0 };
    });
  }

  private scopedWhere(user: CurrentUser, read?: boolean): Prisma.NotificationWhereInput {
    const readFilter = read === undefined
      ? undefined
      : read
        ? { receipts: { some: { userId: user.id } } }
        : { receipts: { none: { userId: user.id } } };
    return { AND: [this.scope(user), ...(readFilter ? [readFilter] : [])] };
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
