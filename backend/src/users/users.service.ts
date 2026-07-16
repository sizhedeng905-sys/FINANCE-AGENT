import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, User, UserRole, UserStatus } from '@prisma/client';
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

const PROTECTED_ROLES = new Set<UserRole>([
  UserRole.finance,
  UserRole.reviewer,
  UserRole.boss,
  UserRole.admin,
  UserRole.auditor
]);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async findMany(query: QueryUsersDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.UserWhereInput = { role: query.role, status: query.status };
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
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.user.count({ where })
    ]);
    return { items: items.map(toPublicUser), page, pageSize, total };
  }

  async findOne(id: string) {
    return toPublicUser(await this.findUserOrThrow(id));
  }

  async create(dto: CreateUserDto, actor: CurrentUser, context: RequestContext) {
    this.assertCanManage(actor, undefined, dto.role);
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
      await this.auditLogs.write(tx, actor, 'user.create', 'user', user.id, { after: toPublicUser(user) }, context);
      await this.notifyTarget(tx, actor, user, 'Account created', `Your ${user.role} account was created.`);
      return toPublicUser(user);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async update(id: string, dto: UpdateUserDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertCanManage(actor, before, dto.role);
      const roleChanged = dto.role !== undefined && dto.role !== before.role;
      if (roleChanged && actor.id === before.id) throw new ForbiddenException('Cannot change your own administrative role');
      if (roleChanged && before.status === UserStatus.active) await this.assertAnotherActiveProtectedRole(tx, before);

      const user = await tx.user.update({
        where: { id },
        data: { ...dto, tokenVersion: roleChanged ? { increment: 1 } : undefined }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'user.update',
        'user',
        user.id,
        { before: toPublicUser(before), after: toPublicUser(user), roleChanged },
        context
      );
      if (roleChanged || PROTECTED_ROLES.has(before.role) || PROTECTED_ROLES.has(user.role)) {
        await this.notifyTarget(tx, actor, user, 'Account privileges changed', `Your account role is now ${user.role}.`);
      }
      return toPublicUser(user);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updatePassword(id: string, dto: UpdateUserPasswordDto, actor: CurrentUser, context: RequestContext) {
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertCanManage(actor, before);
      const user = await tx.user.update({
        where: { id },
        data: { passwordHash, tokenVersion: { increment: 1 } }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'user.password.reset',
        'user',
        user.id,
        { username: before.username, targetRole: before.role },
        context
      );
      await this.notifyTarget(tx, actor, user, 'Password reset', 'Your password was reset and existing sessions were revoked.');
      return { id: user.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertCanManage(actor, before);
      if (actor.id === before.id && dto.status === UserStatus.disabled) {
        throw new ForbiddenException('Cannot disable your own administrative account');
      }
      if (before.status === UserStatus.active && dto.status === UserStatus.disabled) {
        await this.assertAnotherActiveProtectedRole(tx, before);
      }
      const user = await tx.user.update({
        where: { id },
        data: { status: dto.status, tokenVersion: { increment: 1 } }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'user.status.update',
        'user',
        user.id,
        { before: before.status, after: user.status, targetRole: before.role },
        context
      );
      await this.notifyTarget(tx, actor, user, 'Account status changed', `Your account status is now ${user.status}.`);
      return { id: user.id, status: user.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async remove(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findUserOrThrow(id, tx);
      this.assertCanManage(actor, before);
      if (actor.id === before.id) throw new ForbiddenException('Cannot remove your own administrative account');
      if (before.status === UserStatus.active) await this.assertAnotherActiveProtectedRole(tx, before);

      const user = await tx.user.update({
        where: { id },
        data: { status: UserStatus.disabled, tokenVersion: { increment: 1 } }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'user.delete',
        'user',
        before.id,
        { before: toPublicUser(before), after: toPublicUser(user), softDelete: true },
        context
      );
      await this.notifyTarget(tx, actor, user, 'Account disabled', 'Your account was disabled and existing sessions were revoked.');
      return { id, status: user.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private assertCanManage(actor: CurrentUser, target?: User, requestedRole?: UserRole) {
    if (actor.role === UserRole.admin) return;
    if (actor.role !== UserRole.finance && actor.role !== UserRole.boss) {
      throw new ForbiddenException('User administration is not allowed');
    }
    if ((target && target.role !== UserRole.employee) || (requestedRole && requestedRole !== UserRole.employee)) {
      throw new ForbiddenException('Finance and business approvers may manage employee accounts only');
    }
  }

  private async assertAnotherActiveProtectedRole(tx: Prisma.TransactionClient, target: User) {
    if (target.role !== UserRole.boss && target.role !== UserRole.admin) return;
    const remaining = await tx.user.count({
      where: { id: { not: target.id }, role: target.role, status: UserStatus.active }
    });
    if (remaining === 0) throw new ConflictException(`Cannot disable or demote the last active ${target.role} account`);
  }

  private async notifyTarget(
    tx: Prisma.TransactionClient,
    actor: CurrentUser,
    target: User,
    title: string,
    content: string
  ) {
    await tx.notification.create({
      data: {
        title,
        content,
        type: NotificationType.system,
        senderId: actor.id,
        senderName: actor.name,
        targetUserId: target.id
      }
    });
  }

  private async findUserOrThrow(
    id: string,
    prisma: Prisma.TransactionClient | PrismaService = this.prisma
  ): Promise<User> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Resource not found');
    return user;
  }
}
