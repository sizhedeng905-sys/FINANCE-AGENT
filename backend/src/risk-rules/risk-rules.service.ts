import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  AccountingDirection,
  AnomalyStatus,
  BusinessRecordStatus,
  NotificationType,
  Prisma,
  RiskLevel,
  RiskRule,
  UserRole,
  WorkOrderStatus
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { toWorkOrder, workOrderInclude, WorkOrderWithRelations } from '../work-orders/work-order.presenter';
import { CreateRiskRuleDto } from './dto/create-risk-rule.dto';
import { QueryAnomaliesDto } from './dto/query-anomalies.dto';
import { QueryRiskRulesDto } from './dto/query-risk-rules.dto';
import { UpdateRiskRuleDto } from './dto/update-risk-rule.dto';
import { HandleAnomalyDto } from './dto/handle-anomaly.dto';
import { toAnomaly, toRiskRule } from './risk-rule.presenter';

interface RuleEvaluation {
  hit: boolean;
  reason: string;
  suggestion: string;
  evidence: Prisma.InputJsonObject;
}

const riskRank: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

@Injectable()
export class RiskRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService
  ) {}

  async findMany(query: QueryRiskRulesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.RiskRuleWhereInput = { isActive: query.isActive, severity: query.severity };
    const [items, total] = await Promise.all([
      this.prisma.riskRule.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.riskRule.count({ where })
    ]);
    return { items: items.map(toRiskRule), page, pageSize, total };
  }

  async create(dto: CreateRiskRuleDto, actor: CurrentUser, context: RequestContext) {
    this.validateRuleCondition(dto.ruleType, dto.conditionJson);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.riskRule.create({
        data: {
          ...dto,
          targetType: dto.targetType ?? 'work_order',
          conditionJson: dto.conditionJson as Prisma.InputJsonValue,
          isActive: dto.isActive ?? true,
          createdBy: actor.id
        }
      });
      await this.auditLogs.write(tx, actor, 'risk_rule.create', 'risk_rule', rule.id, { after: toRiskRule(rule) }, context);
      return toRiskRule(rule);
    });
  }

  async update(id: string, dto: UpdateRiskRuleDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.riskRule.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('资源不存在');
      this.validateRuleCondition(dto.ruleType ?? before.ruleType, dto.conditionJson ?? this.asObject(before.conditionJson));
      const rule = await tx.riskRule.update({
        where: { id },
        data: {
          ...dto,
          conditionJson: dto.conditionJson as Prisma.InputJsonValue | undefined
        }
      });
      await this.auditLogs.write(tx, actor, 'risk_rule.update', 'risk_rule', id, { before: toRiskRule(before), after: toRiskRule(rule) }, context);
      return toRiskRule(rule);
    });
  }

  async findAnomalies(query: QueryAnomaliesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.AiAnomalyWhereInput = {
      projectId: query.projectId,
      riskLevel: query.riskLevel,
      status: query.status ?? AnomalyStatus.open
    };
    const include = { workOrder: true, project: true, rule: true } as const;
    const [items, total] = await Promise.all([
      this.prisma.aiAnomaly.findMany({ where, include, orderBy: { detectedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.aiAnomaly.count({ where })
    ]);
    return { items: items.map(toAnomaly), page, pageSize, total };
  }

  async handleAnomaly(id: string, dto: HandleAnomalyDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 12))`;
      const before = await tx.aiAnomaly.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('资源不存在');
      const terminal: AnomalyStatus[] = [
        AnomalyStatus.resolved,
        AnomalyStatus.ignored,
        AnomalyStatus.accepted_risk,
        AnomalyStatus.false_positive
      ];
      if (terminal.includes(before.status)) throw new ConflictException('该异常已完成处置');
      const now = new Date();
      const isTerminal = dto.status !== AnomalyStatus.acknowledged;
      const updated = await tx.aiAnomaly.update({
        where: { id },
        data: {
          status: dto.status,
          handledById: actor.id,
          handledByName: actor.name,
          handlingReason: dto.reason,
          handledAt: now,
          resolvedAt: isTerminal ? now : null
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'anomaly.handle',
        'ai_anomaly',
        id,
        { before: { status: before.status }, after: { status: updated.status }, reason: dto.reason },
        context
      );
      await this.ledgerEvents.write(
        tx,
        actor,
        'anomaly_handled',
        'ai_anomaly',
        id,
        { status: updated.status, reason: dto.reason },
        `anomaly:${id}:status:${updated.status}`
      );
      return toAnomaly(await tx.aiAnomaly.findUniqueOrThrow({
        where: { id },
        include: { workOrder: true, project: true, rule: true }
      }));
    });
  }

  async runForWorkOrder(id: string, actor: CurrentUser, context: RequestContext) {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id }, include: workOrderInclude });
    if (!workOrder) throw new NotFoundException('资源不存在');
    if (workOrder.status === WorkOrderStatus.boss_pending) {
      return { workOrder: toWorkOrder(workOrder), runId: null, results: [], alreadyProcessed: true };
    }
    if (workOrder.status !== WorkOrderStatus.ai_reviewing) {
      throw new UnprocessableEntityException(`非法状态流转：当前状态为 ${workOrder.status}`);
    }

    const rules = await this.prisma.riskRule.findMany({
      where: { isActive: true, targetType: 'work_order' },
      orderBy: { createdAt: 'asc' }
    });
    const evaluations = await Promise.all(rules.map(async (rule) => ({ rule, evaluation: await this.evaluate(rule, workOrder) })));
    const hits = evaluations.filter((item) => item.evaluation.hit);
    const riskLevel = hits.reduce<RiskLevel>(
      (highest, item) => (riskRank[item.rule.severity] > riskRank[highest] ? item.rule.severity : highest),
      RiskLevel.low
    );
    const summary = hits.length
      ? `规则复核发现${hits.length}项异常：${hits.map((item) => item.evaluation.reason).join('；')}`
      : '规则复核未发现明显异常';
    const runId = randomUUID();
    const reviewStatus = hits.length ? WorkOrderStatus.ai_flagged : WorkOrderStatus.ai_passed;

    try {
      return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const claimed = await tx.workOrder.updateMany({
        where: { id, status: WorkOrderStatus.ai_reviewing, version: workOrder.version },
        data: { status: reviewStatus, version: { increment: 1 } }
      });
      if (claimed.count !== 1) throw new ConflictException('规则复核任务已被其他请求处理');
      const results = [];
      for (const { rule, evaluation } of evaluations) {
        const result = await tx.ruleRunResult.create({
          data: {
            runId,
            ruleId: rule.id,
            targetType: 'work_order',
            targetId: id,
            projectId: workOrder.projectId,
            workOrderId: id,
            passed: !evaluation.hit,
            riskLevel: evaluation.hit ? rule.severity : null,
            resultJson: evaluation as unknown as Prisma.InputJsonValue,
            runBy: 'system'
          }
        });
        results.push(result);
        if (evaluation.hit) {
          await tx.aiAnomaly.upsert({
            where: { workOrderId_ruleId: { workOrderId: id, ruleId: rule.id } },
            create: {
              anomalyType: rule.ruleType,
              ruleId: rule.id,
              projectId: workOrder.projectId,
              workOrderId: id,
              riskLevel: rule.severity,
              reason: evaluation.reason,
              suggestion: evaluation.suggestion,
              evidence: evaluation.evidence,
              status: AnomalyStatus.open
            },
            update: {
              riskLevel: rule.severity,
              reason: evaluation.reason,
              suggestion: evaluation.suggestion,
              evidence: evaluation.evidence,
              status: AnomalyStatus.open,
              resolvedAt: null,
              handledAt: null,
              handledById: null,
              handledByName: null,
              handlingReason: null,
              detectedAt: new Date()
            }
          });
        } else {
          await tx.aiAnomaly.updateMany({
            where: { workOrderId: id, ruleId: rule.id, status: AnomalyStatus.open },
            data: { status: AnomalyStatus.resolved, resolvedAt: new Date() }
          });
        }
      }

      await tx.workOrderTimeline.create({
        data: {
          workOrderId: id,
          operatorName: '系统规则',
          role: 'system',
          action: '规则复核完成',
          comment: summary,
          fromStatus: WorkOrderStatus.ai_reviewing,
          toStatus: reviewStatus
        }
      });
      await tx.workOrderTimeline.create({
        data: {
          workOrderId: id,
          operatorName: '系统规则',
          role: 'system',
          action: '提交老板审批',
          comment: '规则复核结果已持久化，等待老板最终审批。',
          fromStatus: reviewStatus,
          toStatus: WorkOrderStatus.boss_pending
        }
      });
      const updated = await tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.boss_pending, riskLevel, aiSummary: summary, version: { increment: 1 } },
        include: workOrderInclude
      });
      await tx.notification.create({
        data: {
          title: '工单待老板审批',
          content: `${workOrder.orderNo} 规则复核完成，风险等级：${riskLevel}`,
          type: NotificationType.boss_approval,
          senderName: '系统规则',
          targetRole: UserRole.boss,
          relatedWorkOrderId: id
        }
      });
      await this.auditLogs.write(tx, actor, 'work_order.rules.run', 'work_order', id, { runId, hitCount: hits.length, riskLevel }, context);
      await this.ledgerEvents.write(tx, actor, 'work_order_rules_completed', 'work_order', id, { runId, hitCount: hits.length, riskLevel });
      return {
        workOrder: toWorkOrder(updated),
        runId,
        results: results.map((result) => ({
          id: result.id,
          ruleId: result.ruleId,
          passed: result.passed,
          riskLevel: result.riskLevel,
          result: result.resultJson
        })),
        alreadyProcessed: false
      };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        const current = await this.prisma.workOrder.findUnique({ where: { id }, include: workOrderInclude });
        if (current?.status === WorkOrderStatus.boss_pending) {
          return { workOrder: toWorkOrder(current), runId: null, results: [], alreadyProcessed: true };
        }
      }
      throw error;
    }
  }

  private async evaluate(rule: RiskRule, workOrder: WorkOrderWithRelations): Promise<RuleEvaluation> {
    const condition = this.asObject(rule.conditionJson);
    const threshold = this.number(condition.threshold, 0);
    if (rule.ruleType === 'amount_threshold') {
      const amount = workOrder.amount;
      const thresholdAmount = new Prisma.Decimal(threshold);
      return this.result(
        amount.gt(thresholdAmount),
        `${workOrder.orderNo}金额${amount.toFixed(2)}元超过阈值${thresholdAmount.toFixed(2)}元`,
        '请核对合同、凭证和付款依据。',
        { amount: amount.toFixed(2), threshold: thresholdAmount.toFixed(2) }
      );
    }
    if (rule.ruleType === 'missing_attachment') {
      const amount = workOrder.amount;
      const thresholdAmount = new Prisma.Decimal(threshold);
      const targetType = typeof condition.workOrderType === 'string' ? condition.workOrderType : 'expense';
      const hit = workOrder.type === targetType && amount.gt(thresholdAmount) && workOrder.attachments.length === 0;
      return this.result(
        hit,
        `报销金额${amount.toFixed(2)}元且缺少附件`,
        '请补充发票、付款凭证或业务回单。',
        { amount: amount.toFixed(2), threshold: thresholdAmount.toFixed(2), attachmentCount: workOrder.attachments.length }
      );
    }
    if (rule.ruleType === 'duplicate_submission') {
      if (!workOrder.occurredDate) {
        return this.result(true, '工单缺少发生日期', '请补充业务发生日期后重新提交。', { occurredDate: null });
      }
      const start = new Date(workOrder.occurredDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const hashes = [...new Set(workOrder.attachments.map((item) => item.rawFile.sha256))];
      const reference = this.businessReference(workOrder.extraValues);
      const alternatives: Prisma.WorkOrderWhereInput[] = [
        { amount: workOrder.amount, occurredDate: { gte: start, lt: end } }
      ];
      if (hashes.length) alternatives.push({ attachments: { some: { rawFile: { sha256: { in: hashes } } } } });
      if (reference) alternatives.push({ extraValues: { path: [reference.key], equals: reference.value } });
      const duplicate = await this.prisma.workOrder.findFirst({
        where: {
          id: { not: workOrder.id },
          projectId: workOrder.projectId,
          OR: alternatives,
          status: { notIn: [WorkOrderStatus.finance_rejected, WorkOrderStatus.boss_rejected] }
        },
        select: { id: true, orderNo: true, creatorId: true }
      });
      return this.result(
        Boolean(duplicate),
        `疑似与工单${duplicate?.orderNo ?? ''}重复提交`,
        '请核对同日同项目同金额、票据号或相同附件的工单。',
        {
          duplicateWorkOrderId: duplicate?.id ?? null,
          crossEmployee: duplicate ? duplicate.creatorId !== workOrder.creatorId : false,
          attachmentHashesCompared: hashes.length,
          businessReference: reference?.value ?? null
        }
      );
    }
    if (rule.ruleType === 'after_hours') {
      const submittedAt = workOrder.submittedAt ?? workOrder.createdAt;
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(submittedAt));
      const startHour = this.number(condition.startHour, 8);
      const endHour = this.number(condition.endHour, 20);
      return this.result(hour < startHour || hour >= endHour, `工单在非工作时间${hour}时提交`, '建议确认提交背景和紧急原因。', {
        hour,
        startHour,
        endHour,
        submittedAt: submittedAt.toISOString(),
        timeZone: 'Asia/Shanghai'
      });
    }
    if (rule.ruleType === 'cost_trend') {
      const windowDays = this.integer(condition.windowDays, 7, 1, 365);
      const minimumSamples = this.integer(condition.minimumSamples, 3, 2, 100);
      const referenceDate = workOrder.occurredDate ?? workOrder.submittedAt ?? workOrder.createdAt;
      const since = new Date(referenceDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
      const previous = await this.prisma.businessRecord.findMany({
        where: {
          projectId: workOrder.projectId,
          status: BusinessRecordStatus.confirmed,
          accountingDirection: AccountingDirection.expense,
          recordDate: { gte: since, lt: referenceDate }
        },
        orderBy: [{ recordDate: 'desc' }, { id: 'desc' }],
        take: minimumSamples,
        select: { amount: true }
      });
      const values = previous.reverse().map((item) => item.amount);
      const current = workOrder.cost.gt(0) ? workOrder.cost : workOrder.amount;
      const all = [...values, current];
      const hit = values.length >= minimumSamples && all.every((value, index) => index === 0 || value.gt(all[index - 1]));
      return this.result(
        hit,
        `同项目近${windowDays}天成本连续升高`,
        '请复核近期成本变动和供应商价格。',
        { values: all.map((value) => value.toFixed(2)), windowDays, minimumSamples }
      );
    }
    return this.result(false, '规则类型未支持', '需要人工确认', { ruleType: rule.ruleType });
  }

  private result(hit: boolean, reason: string, suggestion: string, evidence: Prisma.InputJsonObject): RuleEvaluation {
    return { hit, reason, suggestion, evidence };
  }

  private asObject(value: Prisma.JsonValue): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private number(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private integer(value: unknown, fallback: number, minimum: number, maximum: number) {
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
      ? value
      : fallback;
  }

  private businessReference(value: Prisma.JsonValue | null) {
    const object = this.asObject(value ?? {});
    for (const key of ['invoiceNo', 'ticketNo', 'receiptNo', '票据号', '发票号', '单号']) {
      const candidate = object[key];
      if (typeof candidate === 'string' && candidate.trim().length >= 3) {
        return { key, value: candidate.trim().slice(0, 128) };
      }
    }
    return null;
  }

  private validateRuleCondition(ruleType: string, condition: Record<string, unknown>) {
    const allowed = new Set<string>();
    const requireFinite = (key: string, minimum: number, maximum: number, integer = false) => {
      const value = condition[key];
      if (value === undefined) return;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < minimum ||
        value > maximum ||
        (integer && !Number.isInteger(value))
      ) {
        throw new BadRequestException(`风险规则参数 ${key} 不合法`);
      }
      allowed.add(key);
    };
    if (ruleType === 'amount_threshold') requireFinite('threshold', 0, 99999999999999.99);
    if (ruleType === 'missing_attachment') {
      requireFinite('threshold', 0, 99999999999999.99);
      allowed.add('workOrderType');
      if (condition.workOrderType !== undefined && !['expense', 'transport', 'other'].includes(String(condition.workOrderType))) {
        throw new BadRequestException('风险规则参数 workOrderType 不合法');
      }
    }
    if (ruleType === 'duplicate_submission') requireFinite('windowDays', 1, 365, true);
    if (ruleType === 'after_hours') {
      requireFinite('startHour', 0, 23, true);
      requireFinite('endHour', 0, 23, true);
      allowed.add('timeZone');
      if (condition.timeZone !== undefined && condition.timeZone !== 'Asia/Shanghai') {
        throw new BadRequestException('第一版只支持 Asia/Shanghai 时区');
      }
    }
    if (ruleType === 'cost_trend') {
      requireFinite('windowDays', 1, 365, true);
      requireFinite('minimumSamples', 2, 100, true);
    }
    const unknown = Object.keys(condition).filter((key) => !allowed.has(key));
    if (unknown.length) throw new BadRequestException(`风险规则包含未知参数：${unknown.join(', ')}`);
  }
}
