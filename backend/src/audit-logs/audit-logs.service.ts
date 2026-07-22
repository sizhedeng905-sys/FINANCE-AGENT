import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';

type PrismaWriter = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditLogsService {
  async write(
    prisma: PrismaWriter,
    actor: CurrentUser,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: Prisma.InputJsonValue,
    context?: RequestContext
  ) {
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorUsername: actor.username,
        action,
        resourceType,
        resourceId,
        metadata,
        ip: context?.ip,
        userAgent: context?.userAgent,
        requestId: context?.requestId
      }
    });
  }

  async writeAuthentication(
    prisma: PrismaWriter,
    options: {
      userId?: string;
      username: string;
      success: boolean;
      failureReason?: string;
    },
    context?: RequestContext
  ) {
    await prisma.auditLog.create({
      data: {
        actorUserId: options.userId,
        actorUsername: options.username,
        action: options.success ? 'auth.login.success' : 'auth.login.failure',
        resourceType: 'auth_session',
        resourceId: options.userId,
        metadata: { success: options.success },
        ip: context?.ip,
        userAgent: context?.userAgent,
        requestId: context?.requestId,
        failureReason: options.failureReason
      }
    });
  }
}
