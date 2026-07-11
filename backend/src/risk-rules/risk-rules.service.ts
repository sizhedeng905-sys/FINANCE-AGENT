import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  AnomalyStatus,
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

    return this.prisma.$transaction(async (tx) => {
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
          toStatus: WorkOrderStatus.boss_pending
        }
      });
      const updated = await tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.boss_pending, riskLevel, aiSummary: summary },
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
  }

  private async evaluate(rule: RiskRule, workOrder: WorkOrderWithRelations): Promise<RuleEvaluation> {
    const condition = this.asObject(rule.conditionJson);
    const threshold = this.number(condition.threshold, 0);
    if (rule.ruleType === 'amount_threshold') {
      const amount = Number(workOrder.amount);
      return this.result(amount > threshold, `${workOrder.orderNo}金额${amount}元超过阈值${threshold}元`, '请核对合同、凭证和付款依据。', { amount, threshold });
    }
    if (rule.ruleType === 'missing_attachment') {
      const amount = Number(workOrder.amount);
      const targetType = typeof condition.workOrderType === 'string' ? condition.workOrderType : 'expense';
      const hit = workOrder.type === targetType && amount > threshold && workOrder.attachments.length === 0;
      return this.result(hit, `报销金额${amount}元且缺少附件`, '请补充发票、付款凭证或业务回单。', { amount, threshold, attachmentCount: workOrder.attachments.length });
    }
    if (rule.ruleType === 'duplicate_submission') {
      const start = new Date(workOrder.occurredDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      const duplicate = await this.prisma.workOrder.findFirst({
        where: {
          id: { not: workOrder.id },
          projectId: workOrder.projectId,
          creatorId: workOrder.creatorId,
          amount: workOrder.amount,
          occurredDate: { gte: start, lt: end },
          status: { notIn: [WorkOrderStatus.finance_rejected, WorkOrderStatus.boss_rejected] }
        },
        select: { id: true, orderNo: true }
      });
      return this.result(Boolean(duplicate), `疑似与工单${duplicate?.orderNo ?? ''}重复提交`, '请核对同日同项目同金额工单。', { duplicateWorkOrderId: duplicate?.id ?? null });
    }
    if (rule.ruleType === 'after_hours') {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(workOrder.createdAt));
      const startHour = this.number(condition.startHour, 8);
      const endHour = this.number(condition.endHour, 20);
      return this.result(hour < startHour || hour >= endHour, `工单在非工作时间${hour}时提交`, '建议确认提交背景和紧急原因。', { hour, startHour, endHour, timeZone: 'Asia/Shanghai' });
    }
    if (rule.ruleType === 'cost_trend') {
      const since = new Date(workOrder.createdAt.getTime() - 7 * 24 * 60 * 60 * 1000);
      const previous = await this.prisma.workOrder.findMany({
        where: { projectId: workOrder.projectId, createdAt: { gte: since, lt: workOrder.createdAt } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { amount: true, cost: true }
      });
      const values = previous.reverse().map((item) => (Number(item.cost) > 0 ? Number(item.cost) : Number(item.amount)));
      const current = Number(workOrder.cost) > 0 ? Number(workOrder.cost) : Number(workOrder.amount);
      const all = [...values, current];
      const hit = values.length >= 3 && all.every((value, index) => index === 0 || value > all[index - 1]);
      return this.result(hit, '同项目近7天成本连续升高', '请复核近期成本变动和供应商价格。', { values: all });
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
}
