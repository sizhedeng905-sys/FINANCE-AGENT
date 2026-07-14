import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  UserRole,
  WorkOrderStatus
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { RiskRulesService } from '../risk-rules/risk-rules.service';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { QueryWorkOrdersDto } from './dto/query-work-orders.dto';
import { BossApproveDto, FinanceReviewDto, ReviewerReviewDto, UrgeWorkOrderDto } from './dto/review-work-order.dto';
import { SupplementWorkOrderDto } from './dto/supplement-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { toTimelineItem, toWorkOrder, workOrderInclude } from './work-order.presenter';
import { WorkOrderRecordsService } from './work-order-records.service';

type PrismaWriter = Prisma.TransactionClient | PrismaService;

const REVIEWER_VISIBLE_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.reviewer_reviewing,
  WorkOrderStatus.reviewer_rejected,
  WorkOrderStatus.ai_reviewing,
  WorkOrderStatus.ai_passed,
  WorkOrderStatus.ai_flagged,
  WorkOrderStatus.boss_pending,
  WorkOrderStatus.boss_rejected,
  WorkOrderStatus.completed
];
const BOSS_VISIBLE_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.boss_pending,
  WorkOrderStatus.boss_rejected,
  WorkOrderStatus.completed
];
const URGE_FORBIDDEN_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.draft,
  WorkOrderStatus.returned_for_supplement,
  WorkOrderStatus.completed,
  WorkOrderStatus.boss_rejected,
  WorkOrderStatus.finance_rejected
];
const REVIEWER_ACTIVE_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.reviewer_reviewing
];
const BOSS_ACTIVE_STATUSES: WorkOrderStatus[] = [WorkOrderStatus.boss_pending];

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly riskRules: RiskRulesService,
    private readonly workOrderRecords: WorkOrderRecordsService
  ) {}

  async findMany(query: QueryWorkOrdersDto, user: CurrentUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.WorkOrderWhereInput = {
      projectId: query.projectId,
      status: query.status,
      type: query.type,
      urgent: query.urgent
    };
    this.applyRoleScope(where, user);

    const [items, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        include: workOrderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.workOrder.count({ where })
    ]);

    return { items: items.map(toWorkOrder), page, pageSize, total };
  }

  async findOne(id: string, user: CurrentUser) {
    return toWorkOrder(await this.findAccessibleOrThrow(id, user));
  }

  async create(
    dto: CreateWorkOrderDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    this.validateIdempotencyKey(idempotencyKey, false);
    this.validateExtraValues(dto.extraValues);
    if (idempotencyKey) {
      const existing = await this.prisma.workOrder.findUnique({
        where: { creationIdempotencyKey: idempotencyKey },
        include: workOrderInclude
      });
      if (existing) {
        if (existing.creatorId !== actor.id) throw new ConflictException('Idempotency-Key 已被其他请求使用');
        return toWorkOrder(existing);
      }
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const project = await tx.project.findUnique({ where: { id: dto.projectId } });
          if (!project || project.status !== 'active') {
            throw new UnprocessableEntityException('项目不存在或未启用');
          }
          await this.validateAttachments(tx, dto.attachments, actor, project.id);

          const workOrder = await tx.workOrder.create({
            data: {
              orderNo: this.createOrderNo(),
              type: dto.type,
              projectId: project.id,
              projectName: project.name,
              customerName: project.customerName,
              creatorId: actor.id,
              creatorName: actor.name,
              amount: dto.amount ?? 0,
              description: dto.description,
              occurredDate: dto.occurredDate ? this.parseDateOnly(dto.occurredDate, 'occurredDate') : null,
              extraValues: (dto.extraValues ?? {}) as Prisma.InputJsonValue,
              status: WorkOrderStatus.draft,
              creationIdempotencyKey: idempotencyKey,
              attachments: dto.attachments?.length
                ? { create: dto.attachments.map((rawFileId) => ({ rawFileId, uploadedBy: actor.id })) }
                : undefined,
              timeline: {
                create: {
                  operatorId: actor.id,
                  operatorName: actor.name,
                  role: actor.role,
                  action: '保存草稿',
                  comment: '员工创建工单草稿。',
                  toStatus: WorkOrderStatus.draft
                }
              }
            },
            include: workOrderInclude
          });

          if (dto.attachments?.length) {
            await tx.rawFile.updateMany({
              where: { id: { in: dto.attachments } },
              data: { relatedWorkOrderId: workOrder.id, relatedProjectId: project.id }
            });
          }

          await this.auditLogs.write(tx, actor, 'work_order.create', 'work_order', workOrder.id, { status: workOrder.status }, context);
          return toWorkOrder(workOrder);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (idempotencyKey && this.isConcurrentWriteConflict(error)) {
        const existing = await this.prisma.workOrder.findUnique({
          where: { creationIdempotencyKey: idempotencyKey },
          include: workOrderInclude
        });
        if (existing?.creatorId === actor.id) return toWorkOrder(existing);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateWorkOrderDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOwnedOrThrow(id, actor, tx);
      this.assertStatus(before.status, [WorkOrderStatus.draft, WorkOrderStatus.returned_for_supplement]);
      if (Object.keys(dto).length === 0) throw new BadRequestException('至少提供一个可修改字段');
      this.validateExtraValues(dto.extraValues);

      if (dto.projectId) {
        const project = await tx.project.findUnique({ where: { id: dto.projectId } });
        if (!project || project.status !== 'active') throw new UnprocessableEntityException('项目不存在或未启用');
      }
      const project = dto.projectId ? await tx.project.findUnique({ where: { id: dto.projectId } }) : null;
      const targetProjectId = dto.projectId ?? before.projectId;
      await this.validateAttachments(tx, dto.attachments, actor, targetProjectId, id);

      const workOrder = await tx.workOrder.update({
        where: { id },
        data: {
          type: dto.type,
          projectId: dto.projectId,
          projectName: project?.name,
          customerName: project?.customerName,
          amount: dto.amount,
          description: dto.description,
          occurredDate: dto.occurredDate ? this.parseDateOnly(dto.occurredDate, 'occurredDate') : undefined,
          extraValues: dto.extraValues as Prisma.InputJsonValue | undefined,
          attachments: dto.attachments
            ? {
                deleteMany: {},
                create: dto.attachments.map((rawFileId) => ({ rawFileId, uploadedBy: actor.id }))
              }
            : undefined
        },
        include: workOrderInclude
      });
      if (dto.attachments) {
        const removedFileIds = before.attachments
          .map((item) => item.rawFileId)
          .filter((fileId) => !dto.attachments!.includes(fileId));
        if (removedFileIds.length) {
          await tx.rawFile.updateMany({
            where: { id: { in: removedFileIds }, relatedWorkOrderId: id },
            data: { relatedWorkOrderId: null }
          });
        }
        if (dto.attachments.length) {
          await tx.rawFile.updateMany({
            where: { id: { in: dto.attachments } },
            data: { relatedWorkOrderId: id, relatedProjectId: targetProjectId }
          });
        }
      }
      await this.auditLogs.write(tx, actor, 'work_order.update', 'work_order', id, { before: before.updatedAt, after: workOrder.updatedAt }, context);
      return toWorkOrder(workOrder);
    });
  }

  async submit(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOwnedOrThrow(id, actor, tx);
      this.assertStatus(before.status, [WorkOrderStatus.draft, WorkOrderStatus.returned_for_supplement]);
      await this.assertSubmissionComplete(before, tx);
      const changed = await tx.workOrder.updateMany({
        where: { id, status: before.status },
        data: { status: WorkOrderStatus.finance_reviewing }
      });
      if (changed.count !== 1) throw new ConflictException('工单状态已被其他请求更新');
      await tx.workOrderTimeline.create({
        data: {
          workOrderId: id,
          operatorId: actor.id,
          operatorName: actor.name,
          role: actor.role,
          action: '提交工单',
          comment: '工单已提交，等待财务审核。',
          fromStatus: before.status,
          toStatus: WorkOrderStatus.finance_reviewing
        }
      });
      await tx.notification.create({
        data: {
          title: '新工单待财务审核',
          content: `${actor.name}提交工单 ${before.orderNo}`,
          type: NotificationType.audit,
          senderId: actor.id,
          senderName: actor.name,
          targetRole: UserRole.finance,
          relatedWorkOrderId: id
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'work_order.submit',
        'work_order',
        id,
        { from: before.status, to: WorkOrderStatus.finance_reviewing },
        context
      );
      return toWorkOrder(await this.findByIdOrThrow(id, tx));
    });
  }

  async supplement(id: string, dto: SupplementWorkOrderDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOwnedOrThrow(id, actor, tx);
      this.assertStatus(before.status, [WorkOrderStatus.returned_for_supplement]);
      const existingFileIds = new Set(before.attachments.map((attachment) => attachment.rawFileId));
      const newAttachmentIds = (dto.attachments ?? []).filter((fileId) => !existingFileIds.has(fileId));
      if (existingFileIds.size + newAttachmentIds.length > 20) {
        throw new BadRequestException('单个工单最多关联 20 个附件');
      }
      await this.validateAttachments(tx, newAttachmentIds, actor, before.projectId, id);

      const supplemented = await tx.workOrder.update({
        where: { id },
        data: {
          description: dto.description,
          attachments: newAttachmentIds.length
            ? { create: newAttachmentIds.map((rawFileId) => ({ rawFileId, uploadedBy: actor.id })) }
            : undefined
        },
        include: workOrderInclude
      });
      if (newAttachmentIds.length) {
        await tx.rawFile.updateMany({
          where: { id: { in: newAttachmentIds } },
          data: { relatedWorkOrderId: id, relatedProjectId: before.projectId }
        });
      }
      await this.assertSubmissionComplete(supplemented, tx);
      const changed = await tx.workOrder.updateMany({
        where: { id, status: WorkOrderStatus.returned_for_supplement },
        data: { status: WorkOrderStatus.finance_reviewing }
      });
      if (changed.count !== 1) throw new ConflictException('工单状态已被其他请求更新');
      await tx.workOrderTimeline.create({
        data: {
          workOrderId: id,
          operatorId: actor.id,
          operatorName: actor.name,
          role: actor.role,
          action: '补充材料并重新提交',
          comment: dto.comment,
          fromStatus: WorkOrderStatus.returned_for_supplement,
          toStatus: WorkOrderStatus.finance_reviewing
        }
      });
      await tx.notification.create({
        data: {
          title: '补充材料待财务复审',
          content: `${actor.name}已补充工单 ${before.orderNo}`,
          type: NotificationType.audit,
          senderId: actor.id,
          senderName: actor.name,
          targetRole: UserRole.finance,
          relatedWorkOrderId: id
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'work_order.supplement',
        'work_order',
        id,
        { attachmentIds: newAttachmentIds, comment: dto.comment },
        context
      );
      return toWorkOrder(await this.findByIdOrThrow(id, tx));
    });
  }

  async financeReview(id: string, dto: FinanceReviewDto, actor: CurrentUser, context: RequestContext) {
    const next = {
      approve: WorkOrderStatus.reviewer_reviewing,
      reject: WorkOrderStatus.finance_rejected,
      supplement: WorkOrderStatus.returned_for_supplement
    }[dto.action];
    return this.reviewTransition(
      id,
      actor,
      context,
      [WorkOrderStatus.finance_reviewing, WorkOrderStatus.reviewer_rejected],
      next,
      dto.action,
      dto.comment,
      'financeOpinion'
    );
  }

  async reviewerReview(id: string, dto: ReviewerReviewDto, actor: CurrentUser, context: RequestContext) {
    const next = {
      approve: WorkOrderStatus.ai_reviewing,
      reject_to_finance: WorkOrderStatus.reviewer_rejected,
      supplement: WorkOrderStatus.returned_for_supplement
    }[dto.action];
    const reviewed = await this.reviewTransition(
      id,
      actor,
      context,
      [WorkOrderStatus.reviewer_reviewing],
      next,
      dto.action,
      dto.comment,
      'reviewerOpinion'
    );
    if (dto.action === 'approve') {
      const ruleRun = await this.riskRules.runForWorkOrder(id, actor, context);
      return ruleRun.workOrder;
    }
    return reviewed;
  }

  async aiReview(id: string, actor: CurrentUser, context: RequestContext) {
    const result = await this.riskRules.runForWorkOrder(id, actor, context);
    return result.workOrder;
  }

  async bossApprove(
    id: string,
    dto: BossApproveDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    this.validateIdempotencyKey(idempotencyKey, true);
    const next = dto.action === 'approve' ? WorkOrderStatus.completed : WorkOrderStatus.boss_rejected;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
          const before = await this.findByIdOrThrow(id, tx);
          if (before.status === WorkOrderStatus.completed && before.generatedRecordId) {
            return toWorkOrder(before);
          }
          if (
            before.status === WorkOrderStatus.boss_rejected &&
            before.approvalIdempotencyKey === idempotencyKey
          ) {
            return toWorkOrder(before);
          }
          this.assertStatus(before.status, [WorkOrderStatus.boss_pending]);
          await this.writeApprovalAndTimeline(tx, before, actor, dto.action, dto.comment, next);
          const generatedRecord =
            dto.action === 'approve'
              ? await this.workOrderRecords.createWithinTransaction(tx, before, actor, context)
              : undefined;
          const updated = await tx.workOrder.update({
            where: { id },
            data: {
              status: next,
              bossOpinion: dto.comment,
              completedAt: next === WorkOrderStatus.completed ? new Date() : undefined,
              generatedRecordId: generatedRecord?.id,
              approvalIdempotencyKey: idempotencyKey
            },
            include: workOrderInclude
          });
          await tx.notification.create({
            data: {
              title: dto.action === 'approve' ? '工单审批通过' : '工单被老板驳回',
              content: `工单 ${before.orderNo} 已完成老板审批`,
              type: NotificationType.system,
              senderId: actor.id,
              senderName: actor.name,
              targetUserId: before.creatorId,
              targetRole: UserRole.employee,
              relatedWorkOrderId: id
            }
          });
          await this.auditLogs.write(tx, actor, 'work_order.boss_approve', 'work_order', id, { action: dto.action, from: before.status, to: next }, context);
          return toWorkOrder(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (error) {
      if (this.isConcurrentWriteConflict(error)) {
        const current = await this.findByIdOrThrow(id);
        if (current.status === WorkOrderStatus.completed && current.generatedRecordId) return toWorkOrder(current);
        if (
          current.status === WorkOrderStatus.boss_rejected &&
          current.approvalIdempotencyKey === idempotencyKey
        ) {
          return toWorkOrder(current);
        }
      }
      throw error;
    }
  }

  async urge(id: string, dto: UrgeWorkOrderDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOwnedOrThrow(id, actor, tx);
      if (URGE_FORBIDDEN_STATUSES.includes(before.status)) {
        throw new UnprocessableEntityException('当前状态不能催办');
      }
      if (before.urgentTime && Date.now() - before.urgentTime.getTime() < 30 * 60 * 1000) {
        throw new UnprocessableEntityException('同一工单30分钟内只能催办一次');
      }
      const targetRole = this.resolveCurrentRole(before.status);
      await tx.workOrderTimeline.create({
        data: {
          workOrderId: id,
          operatorId: actor.id,
          operatorName: actor.name,
          role: actor.role,
          action: '催办',
          comment: dto.reason,
          fromStatus: before.status,
          toStatus: before.status
        }
      });
      await tx.notification.create({
        data: {
          title: '员工催办通知',
          content: `${actor.name}催办工单 ${before.orderNo}：${dto.reason}`,
          type: NotificationType.urgent,
          senderId: actor.id,
          senderName: actor.name,
          targetRole,
          relatedWorkOrderId: id
        }
      });
      const updated = await tx.workOrder.update({
        where: { id },
        data: { urgent: true, urgentReason: dto.reason, urgentTime: new Date() },
        include: workOrderInclude
      });
      await this.auditLogs.write(tx, actor, 'work_order.urge', 'work_order', id, { reason: dto.reason, targetRole }, context);
      return toWorkOrder(updated);
    });
  }

  async timeline(id: string, user: CurrentUser) {
    const workOrder = await this.findAccessibleOrThrow(id, user);
    return workOrder.timeline.map(toTimelineItem);
  }

  generateRecord(id: string, actor: CurrentUser, context: RequestContext) {
    return this.workOrderRecords.generate(id, actor, context);
  }

  private async reviewTransition(
    id: string,
    actor: CurrentUser,
    context: RequestContext,
    expected: WorkOrderStatus[],
    next: WorkOrderStatus,
    action: string,
    comment: string | undefined,
    opinionField: 'financeOpinion' | 'reviewerOpinion'
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findByIdOrThrow(id, tx);
      this.assertStatus(before.status, expected);
      const changed = await tx.workOrder.updateMany({
        where: { id, status: before.status },
        data: { status: next, [opinionField]: comment }
      });
      if (changed.count !== 1) throw new ConflictException('工单状态已被其他请求更新');
      await this.writeApprovalAndTimeline(tx, before, actor, action, comment, next);
      await this.createReviewNotification(tx, before, actor, next);
      await this.auditLogs.write(
        tx,
        actor,
        `work_order.${actor.role}_review`,
        'work_order',
        id,
        { action, from: before.status, to: next },
        context
      );
      return toWorkOrder(await this.findByIdOrThrow(id, tx));
    });
  }

  private async transition(
    id: string,
    actor: CurrentUser,
    context: RequestContext,
    options: {
      expected: WorkOrderStatus[];
      next: WorkOrderStatus;
      action: string;
      comment: string;
      ownerOnly?: boolean;
      notifyRole?: UserRole;
    }
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = options.ownerOnly ? await this.findOwnedOrThrow(id, actor, tx) : await this.findByIdOrThrow(id, tx);
      this.assertStatus(before.status, options.expected);
      await tx.workOrderTimeline.create({
        data: {
          workOrderId: id,
          operatorId: actor.id,
          operatorName: actor.name,
          role: actor.role,
          action: options.action,
          comment: options.comment,
          fromStatus: before.status,
          toStatus: options.next
        }
      });
      const updated = await tx.workOrder.update({ where: { id }, data: { status: options.next }, include: workOrderInclude });
      if (options.notifyRole) {
        await tx.notification.create({
          data: {
            title: options.action,
            content: `工单 ${before.orderNo} 状态已更新`,
            type: NotificationType.audit,
            senderId: actor.id,
            senderName: actor.name,
            targetRole: options.notifyRole,
            relatedWorkOrderId: id
          }
        });
      }
      await this.auditLogs.write(tx, actor, 'work_order.submit', 'work_order', id, { from: before.status, to: options.next }, context);
      return toWorkOrder(updated);
    });
  }

  private async writeApprovalAndTimeline(
    tx: Prisma.TransactionClient,
    before: Awaited<ReturnType<WorkOrdersService['findByIdOrThrow']>>,
    actor: CurrentUser,
    action: string,
    comment: string | undefined,
    next: WorkOrderStatus
  ) {
    await tx.approval.create({
      data: { workOrderId: before.id, approverId: actor.id, approverRole: actor.role, action, comment }
    });
    await tx.workOrderTimeline.create({
      data: {
        workOrderId: before.id,
        operatorId: actor.id,
        operatorName: actor.name,
        role: actor.role,
        action,
        comment,
        fromStatus: before.status,
        toStatus: next
      }
    });
  }

  private async createReviewNotification(
    tx: Prisma.TransactionClient,
    workOrder: Awaited<ReturnType<WorkOrdersService['findByIdOrThrow']>>,
    actor: CurrentUser,
    next: WorkOrderStatus
  ) {
    if (next === WorkOrderStatus.ai_reviewing) return;
    const data: Prisma.NotificationCreateInput = {
      title: '工单流程更新',
      content: `工单 ${workOrder.orderNo} 已由${actor.name}处理`,
      type: NotificationType.audit,
      senderId: actor.id,
      senderName: actor.name,
      workOrder: { connect: { id: workOrder.id } }
    };
    if (next === WorkOrderStatus.reviewer_reviewing) data.targetRole = UserRole.reviewer;
    else if (next === WorkOrderStatus.reviewer_rejected) data.targetRole = UserRole.finance;
    else {
      data.targetRole = UserRole.employee;
      data.targetUserId = workOrder.creatorId;
    }
    await tx.notification.create({ data });
  }

  private async validateAttachments(
    tx: Prisma.TransactionClient,
    attachmentIds: string[] | undefined,
    actor: CurrentUser,
    projectId: string,
    workOrderId?: string
  ) {
    if (!attachmentIds?.length) return;
    const files = await tx.rawFile.findMany({
      where: { id: { in: attachmentIds }, isVoided: false }
    });
    if (files.length !== attachmentIds.length) throw new UnprocessableEntityException('附件不存在或已作废');
    for (const file of files) {
      if (actor.role === UserRole.employee && file.uploadedBy !== actor.id) {
        throw new ForbiddenException('只能使用自己上传的附件');
      }
      if (file.relatedProjectId && file.relatedProjectId !== projectId) {
        throw new UnprocessableEntityException('附件不属于当前项目');
      }
      if (file.relatedWorkOrderId && file.relatedWorkOrderId !== workOrderId) {
        throw new UnprocessableEntityException('附件已关联其他工单');
      }
    }
  }

  private async assertSubmissionComplete(
    workOrder: Awaited<ReturnType<WorkOrdersService['findByIdOrThrow']>>,
    prisma: PrismaWriter
  ) {
    const missing: string[] = [];
    if (new Prisma.Decimal(workOrder.amount).lessThanOrEqualTo(0)) missing.push('amount');
    if (!workOrder.description?.trim()) missing.push('description');
    if (!workOrder.occurredDate) missing.push('occurredDate');
    if (missing.length) {
      throw new UnprocessableEntityException(`工单信息不完整：${missing.join(', ')}`);
    }
    const project = await prisma.project.findUnique({ where: { id: workOrder.projectId } });
    if (!project || project.status !== 'active') {
      throw new UnprocessableEntityException('项目不存在或未启用');
    }
  }

  private parseDateOnly(value: string, fieldName: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${fieldName} 必须是 YYYY-MM-DD 格式`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${fieldName} 必须是有效日期`);
    }
    return date;
  }

  private validateExtraValues(value: Record<string, unknown> | undefined) {
    if (!value) return;
    if (Object.keys(value).length > 50 || JSON.stringify(value).length > 20_000) {
      throw new BadRequestException('extraValues 超出允许的大小');
    }
  }

  private validateIdempotencyKey(value: string | undefined, required: boolean) {
    if (required && !value) throw new BadRequestException('缺少 Idempotency-Key');
    if (value && (value.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(value))) {
      throw new BadRequestException('Idempotency-Key 格式不正确');
    }
  }

  private applyRoleScope(where: Prisma.WorkOrderWhereInput, user: CurrentUser) {
    if (user.role === UserRole.employee) where.creatorId = user.id;
    if (user.role === UserRole.reviewer) {
      if (typeof where.status === 'string' && !REVIEWER_VISIBLE_STATUSES.includes(where.status)) {
        throw new ForbiddenException('无权查询该状态的工单');
      }
      where.status = where.status ?? { in: REVIEWER_VISIBLE_STATUSES };
    }
    if (user.role === UserRole.boss) {
      if (typeof where.status === 'string' && !BOSS_VISIBLE_STATUSES.includes(where.status)) {
        throw new ForbiddenException('无权查询该状态的工单');
      }
      where.status = where.status ?? { in: BOSS_VISIBLE_STATUSES };
    }
  }

  private async findAccessibleOrThrow(id: string, user: CurrentUser) {
    const workOrder = await this.findByIdOrThrow(id);
    if (user.role === UserRole.employee && workOrder.creatorId !== user.id) throw new ForbiddenException('无权访问该工单');
    if (user.role === UserRole.reviewer && !REVIEWER_VISIBLE_STATUSES.includes(workOrder.status)) throw new ForbiddenException('无权访问该工单');
    if (user.role === UserRole.boss && !BOSS_VISIBLE_STATUSES.includes(workOrder.status)) throw new ForbiddenException('无权访问该工单');
    return workOrder;
  }

  private async findOwnedOrThrow(id: string, actor: CurrentUser, prisma: PrismaWriter = this.prisma) {
    const workOrder = await this.findByIdOrThrow(id, prisma);
    if (workOrder.creatorId !== actor.id) throw new ForbiddenException('只能操作自己的工单');
    return workOrder;
  }

  private async findByIdOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const workOrder = await prisma.workOrder.findUnique({ where: { id }, include: workOrderInclude });
    if (!workOrder) throw new NotFoundException('资源不存在');
    return workOrder;
  }

  private assertStatus(actual: WorkOrderStatus, expected: WorkOrderStatus[]) {
    if (!expected.includes(actual)) {
      throw new UnprocessableEntityException(`非法状态流转：当前状态为 ${actual}`);
    }
  }

  private resolveCurrentRole(status: WorkOrderStatus): UserRole {
    if (REVIEWER_ACTIVE_STATUSES.includes(status)) return UserRole.reviewer;
    if (BOSS_ACTIVE_STATUSES.includes(status)) return UserRole.boss;
    return UserRole.finance;
  }

  private createOrderNo() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = `${now.getTime()}`.slice(-7) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `WO${date}${suffix}`;
  }

  private isConcurrentWriteConflict(error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    return ['P2002', 'P2034'].includes(String((error as { code: unknown }).code));
  }
}
