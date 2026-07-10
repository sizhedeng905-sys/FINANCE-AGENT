import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';
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
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      const user = await tx.user.update({
        where: {
          id
        },
        data: dto
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
    });
  }

  async updatePassword(id: string, dto: UpdateUserPasswordDto, actor: CurrentUser, context: RequestContext) {
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      const user = await tx.user.update({
        where: {
          id
        },
        data: {
          passwordHash
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
      const user = await tx.user.update({
        where: {
          id
        },
        data: {
          status: dto.status
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
    });
  }

  async remove(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);

      await this.auditLogs.write(
        tx,
        actor,
        'user.delete',
        'user',
        before.id,
        {
          before: toPublicUser(before)
        },
        context
      );

      await tx.user.delete({
        where: {
          id
        }
      });

      return {
        id
      };
    });
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
