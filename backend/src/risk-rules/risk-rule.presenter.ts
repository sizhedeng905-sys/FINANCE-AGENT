import { AiAnomaly, Prisma, RiskRule } from '@prisma/client';

export function toRiskRule(rule: RiskRule) {
  return {
    id: rule.id,
    ruleKey: rule.ruleKey,
    ruleName: rule.ruleName,
    ruleType: rule.ruleType,
    targetType: rule.targetType,
    severity: rule.severity,
    conditionJson: rule.conditionJson,
    description: rule.description ?? '',
    isActive: rule.isActive,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

type AnomalyWithRelations = Prisma.AiAnomalyGetPayload<{
  include: { workOrder: true; project: true; rule: true };
}>;

export function toAnomaly(anomaly: AnomalyWithRelations) {
  return {
    id: anomaly.id,
    workOrderId: anomaly.workOrderId,
    orderNo: anomaly.workOrder.orderNo,
    projectId: anomaly.projectId ?? undefined,
    projectName: anomaly.project?.name ?? anomaly.workOrder.projectName,
    type: anomaly.anomalyType,
    amount: Number(anomaly.workOrder.amount),
    riskLevel: anomaly.riskLevel,
    reason: anomaly.reason,
    suggestion: anomaly.suggestion ?? '',
    evidence: anomaly.evidence ?? {},
    status: anomaly.status,
    statusText: anomaly.workOrder.status,
    rule: toRiskRule(anomaly.rule),
    detectedAt: anomaly.detectedAt.toISOString(),
    updatedAt: anomaly.updatedAt.toISOString()
  };
}
