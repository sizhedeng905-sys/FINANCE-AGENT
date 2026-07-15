import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toPublicUser } from '../common/utils/user-presenter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async findMany(query: QueryUsersDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.UserWhereInput = {
      role: query.role,
      status: query.status
    };

    if (query.keyword) {
      where.OR = [
        { username: { contains: query.keyword, mode: 'insensitive' } },
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { department: { contains: query.keyword, mode: 'insensitive' } },
        { phone: { contains: query.keyword, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: {
          createdAt: 'desc'
        },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.user.count({ where })
    ]);

    return {
      items: items.map(toPublicUser),
      page,
      pageSize,
      total
    };
  }

  async findOne(id: string) {
    return toPublicUser(await this.findUserOrThrow(id));
  }

  async create(dto: CreateUserDto, actor: CurrentUser, context: RequestContext) {
    this.assertFinanceBossBoundary(actor, undefined, dto.role);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          passwordHash,
          name: dto.name,
          role: dto.role,
          department: dto.department,
          phone: dto.phone,
          status: dto.status ?? UserStatus.active,
          createdBy: actor.id
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'user.create',
        'user',
        user.id,
        {
          after: toPublicUser(user)
        },
        context
      );

      return toPublicUser(user);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async update(id: string, dto: UpdateUserDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertFinanceBossBoundary(actor, before, dto.role);
      const roleChanged = dto.role !== undefined && dto.role !== before.role;
      if (before.role === UserRole.boss && before.status === UserStatus.active && roleChanged) {
        await this.assertAnotherActiveBoss(tx, before.id);
      }
      const user = await tx.user.update({
        where: {
          id
        },
        data: {
          ...dto,
          tokenVersion: roleChanged ? { increment: 1 } : undefined
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'user.update',
        'user',
        user.id,
        {
          before: toPublicUser(before),
          after: toPublicUser(user)
        },
        context
      );

      return toPublicUser(user);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updatePassword(id: string, dto: UpdateUserPasswordDto, actor: CurrentUser, context: RequestContext) {
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertFinanceBossBoundary(actor, before);
      const user = await tx.user.update({
        where: {
          id
        },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 }
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'user.password.reset',
        'user',
        user.id,
        {
          username: before.username
        },
        context
      );

      return {
        id: user.id
      };
    });
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertFinanceBossBoundary(actor, before);
      if (
        before.role === UserRole.boss &&
        before.status === UserStatus.active &&
        dto.status === UserStatus.disabled
      ) {
        await this.assertAnotherActiveBoss(tx, before.id);
      }
      const user = await tx.user.update({
        where: {
          id
        },
        data: {
          status: dto.status,
          tokenVersion: { increment: 1 }
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'user.status.update',
        'user',
        user.id,
        {
          before: before.status,
          after: user.status
        },
        context
      );

      return {
        id: user.id,
        status: user.status
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async remove(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertFinanceBossBoundary(actor, before);
      if (before.role === UserRole.boss && before.status === UserStatus.active) {
        await this.assertAnotherActiveBoss(tx, before.id);
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          status: UserStatus.disabled,
          tokenVersion: { increment: 1 }
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'user.delete',
        'user',
        before.id,
        {
          before: toPublicUser(before),
          after: toPublicUser(user),
          softDelete: true
        },
        context
      );

      return {
        id,
        status: user.status
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private assertFinanceBossBoundary(actor: CurrentUser, target?: User, requestedRole?: UserRole) {
    if (actor.role !== UserRole.finance) return;
    if (target?.role === UserRole.boss || requestedRole === UserRole.boss) {
      throw new ForbiddenException('财务角色不能创建、提升或操作老板账号');
    }
  }

  private async assertAnotherActiveBoss(prisma: Prisma.TransactionClient, excludedUserId: string) {
    const remainingBosses = await prisma.user.count({
      where: {
        id: { not: excludedUserId },
        role: UserRole.boss,
        status: UserStatus.active
      }
    });
    if (remainingBosses === 0) {
      throw new ConflictException('不能停用、降级或删除最后一个有效老板账号');
    }
  }

  private async findUserOrThrow(id: string, prisma: Prisma.TransactionClient | PrismaService = this.prisma): Promise<User> {
    const user = await prisma.user.findUnique({
      where: {
        id
      }
    });

    if (!user) {
      throw new NotFoundException('资源不存在');
    }

    return user;
  }
}
