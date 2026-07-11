import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';

type PrismaWriter = Prisma.TransactionClient | PrismaService;

@Injectable()
export class LedgerEventsService {
  async write(
    prisma: PrismaWriter,
    actor: CurrentUser,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Prisma.InputJsonValue
  ) {
    await prisma.ledgerEvent.create({
      data: {
        eventType,
        aggregateType,
        aggregateId,
        actorUserId: actor.id,
        actorUsername: actor.username,
        payload
      }
    });
  }
}
