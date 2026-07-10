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
        userAgent: context?.userAgent
      }
    });
  }
}
