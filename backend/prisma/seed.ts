import {
  AccountingDirection,
  BusinessRecordStatus,
  DataRecordType,
  FieldType,
  Prisma,
  PrismaClient,
  RecordSourceType,
  RiskLevel,
  SemanticType,
  WorkOrderStatus,
  WorkOrderType
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function assertSafeSeedEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required before running the development seed.');
  }

  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    throw new Error('The demo seed requires NODE_ENV=development or NODE_ENV=test exactly.');
  }

  let databaseName = '';
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL.');
  }

  const isDedicatedDevelopmentDatabase = /_(dev|test)$/.test(databaseName);
  if (!isDedicatedDevelopmentDatabase && process.env.SEED_ALLOW_NONSTANDARD_DATABASE !== 'true') {
    throw new Error(
      `Refusing to seed database "${databaseName}". Use a database ending in _dev or _test, or explicitly set SEED_ALLOW_NONSTANDARD_DATABASE=true outside production.`
    );
  }
  const expectedConfirmation = `reset-demo-users:${databaseName}`;
  if (process.env.SEED_DEMO_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`Set SEED_DEMO_CONFIRMATION=${expectedConfirmation} to confirm resetting demo users.`);
  }
}

async function main() {
  assertSafeSeedEnvironment();
  const passwordHash = await bcrypt.hash('123456', 10);
  const users = [
    {
      username: '员工',
      name: '员工',
      role: 'employee' as const,
      department: '运营部',
      phone: '13800000001'
    },
    {
      username: '财务',
      name: '财务',
      role: 'finance' as const,
      department: '财务部',
      phone: '13800000002'
    },
    {
      username: '复核员',
      name: '复核员',
      role: 'reviewer' as const,
      department: '复核部',
      phone: '13800000003'
    },
    {
      username: '老板',
      name: '老板',
      role: 'boss' as const,
      department: '总经办',
      phone: '13800000004'
    },
    {
      username: 'employee',
      name: '员工',
      role: 'employee' as const,
      department: '运营部',
      phone: '13800000011'
    },
    {
      username: 'finance',
      name: '财务',
      role: 'finance' as const,
      department: '财务部',
      phone: '13800000012'
    },
    {
      username: 'reviewer',
      name: '复核员',
      role: 'reviewer' as const,
      department: '复核部',
      phone: '13800000013'
    },
    {
      username: 'boss',
      name: '老板',
      role: 'boss' as const,
      department: '总经办',
      phone: '13800000014'
    },
    {
      username: 'admin',
      name: '系统管理员',
      role: 'admin' as const,
      department: '系统管理',
      phone: '13800000015'
    },
    {
      username: 'auditor',
      name: '安全审计员',
      role: 'auditor' as const,
      department: '安全审计',
      phone: '13800000016'
    }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: {
        username: user.username
      },
      create: {
        ...user,
        passwordHash,
        status: 'active'
      },
      update: {
        name: user.name,
        role: user.role,
        department: user.department,
        phone: user.phone,
        passwordHash,
        status: 'active',
        tokenVersion: { increment: 1 }
      }
    });
  }

  const fields = [
    ['f-date', 'date', '日期', FieldType.date, '', SemanticType.date, ['发生日期', '业务日期']],
    ['f-amount', 'amount', '金额', FieldType.money, '元', SemanticType.amount, ['费用金额', '总金额']],
    ['f-plate', 'vehiclePlate', '车牌号', FieldType.text, '', SemanticType.vehicle, ['车牌', '车辆']],
    ['f-driver', 'driverName', '司机', FieldType.text, '', SemanticType.person, ['驾驶员']],
    ['f-start', 'startLocation', '起点', FieldType.text, '', SemanticType.location, ['始发地']],
    ['f-end', 'endLocation', '终点', FieldType.text, '', SemanticType.location, ['目的地']],
    ['f-hours', 'workHours', '工时', FieldType.number, '小时', SemanticType.amount, ['小时数']],
    ['f-person', 'personName', '人员姓名', FieldType.text, '', SemanticType.person, ['员工姓名']],
    ['f-position', 'position', '岗位', FieldType.select, '', SemanticType.category, ['工种']],
    ['f-utility', 'utilityType', '水电类型', FieldType.select, '', SemanticType.category, ['水费电费']],
    ['f-site', 'siteName', '场地名称', FieldType.text, '', SemanticType.location, ['仓库', '场地']],
    ['f-attachment', 'attachment', '附件', FieldType.file, '', SemanticType.file, ['凭证', '发票']],
    ['f-remark', 'remark', '备注', FieldType.textarea, '', SemanticType.remark, ['说明']],
    ['f-ticket', 'ticketCount', '票数', FieldType.number, '票', SemanticType.amount, ['单量']],
    ['f-ton', 'tonnage', '吨数', FieldType.number, '吨', SemanticType.amount, ['重量']],
    ['f-income', 'incomeAmount', '收入金额', FieldType.money, '元', SemanticType.amount, ['营收']],
    ['f-cost-category', 'costCategory', '成本分类', FieldType.select, '', SemanticType.category, ['费用分类']],
    ['f-reason', 'expenseReason', '费用事由', FieldType.textarea, '', SemanticType.remark, ['报销原因']],
    ['f-payee', 'payee', '付款对象', FieldType.text, '', SemanticType.person, ['收款方']],
    ['f-unit-price', 'unitPrice', '单价', FieldType.money, '元', SemanticType.amount, ['价格']]
  ] as const;

  for (const [id, fieldKey, fieldName, fieldType, unit, semanticType, aliases] of fields) {
    await prisma.fieldDefinition.upsert({
      where: {
        id
      },
      create: {
        id,
        fieldKey,
        fieldName,
        fieldType,
        unit,
        semanticType,
        aliases,
        description: `${fieldName}字段定义`,
        isActive: true
      },
      update: {
        fieldKey,
        fieldName,
        fieldType,
        unit,
        semanticType,
        aliases,
        description: `${fieldName}字段定义`,
        isActive: true
      }
    });
  }

  const templates = [
    {
      id: 'dt-transport',
      name: '运输费用模板',
      recordType: DataRecordType.transport,
      accountingDirection: AccountingDirection.expense,
      primaryAmountFieldId: 'f-amount',
      primaryDateFieldId: 'f-date',
      description: '记录车辆、司机、线路和运输成本。'
    },
    {
      id: 'dt-labor',
      name: '人工劳务费用模板',
      recordType: DataRecordType.labor,
      accountingDirection: AccountingDirection.expense,
      primaryAmountFieldId: 'f-amount',
      primaryDateFieldId: 'f-date',
      description: '记录人员、岗位、工时和单价。'
    },
    {
      id: 'dt-site',
      name: '场地费用模板',
      recordType: DataRecordType.cost,
      accountingDirection: AccountingDirection.expense,
      primaryAmountFieldId: 'f-amount',
      primaryDateFieldId: 'f-date',
      description: '记录场地、水电和固定成本。'
    },
    {
      id: 'dt-revenue',
      name: '收入记录模板',
      recordType: DataRecordType.revenue,
      accountingDirection: AccountingDirection.income,
      primaryAmountFieldId: 'f-income',
      primaryDateFieldId: 'f-date',
      description: '记录票数、吨数和收入金额。'
    },
    {
      id: 'dt-reimbursement',
      name: '报销工单模板',
      recordType: DataRecordType.reimbursement,
      accountingDirection: AccountingDirection.expense,
      primaryAmountFieldId: 'f-amount',
      primaryDateFieldId: 'f-date',
      description: '记录报销事由、成本分类、付款对象和凭证。'
    },
    {
      id: 'dt-other',
      name: '其他支出模板',
      recordType: DataRecordType.other,
      accountingDirection: AccountingDirection.expense,
      primaryAmountFieldId: 'f-amount',
      primaryDateFieldId: 'f-date',
      description: '记录不属于标准报销分类的临时支出。'
    }
  ];

  for (const template of templates) {
    await prisma.template.upsert({
      where: {
        id: template.id
      },
      create: {
        ...template,
        isSystem: true,
        createdBy: '系统'
      },
      update: {
        name: template.name,
        recordType: template.recordType,
        accountingDirection: template.accountingDirection,
        primaryAmountFieldId: template.primaryAmountFieldId,
        primaryDateFieldId: template.primaryDateFieldId,
        description: template.description,
        isSystem: true,
        createdBy: '系统'
      }
    });
  }

  const templateFieldMap: Record<string, string[]> = {
    'dt-transport': ['f-date', 'f-plate', 'f-driver', 'f-start', 'f-end', 'f-amount', 'f-remark', 'f-attachment'],
    'dt-labor': ['f-date', 'f-person', 'f-position', 'f-hours', 'f-unit-price', 'f-amount', 'f-remark'],
    'dt-site': ['f-date', 'f-site', 'f-utility', 'f-amount', 'f-remark', 'f-attachment'],
    'dt-revenue': ['f-date', 'f-site', 'f-ticket', 'f-ton', 'f-income', 'f-remark'],
    'dt-reimbursement': ['f-date', 'f-reason', 'f-cost-category', 'f-amount', 'f-payee', 'f-attachment', 'f-remark'],
    'dt-other': ['f-date', 'f-reason', 'f-cost-category', 'f-amount', 'f-payee', 'f-attachment', 'f-remark']
  };

  for (const [templateId, fieldIds] of Object.entries(templateFieldMap)) {
    for (const [index, fieldId] of fieldIds.entries()) {
      await prisma.templateField.upsert({
        where: {
          templateId_fieldId: {
            templateId,
            fieldId
          }
        },
        create: {
          id: `tf-${templateId}-${fieldId}`,
          templateId,
          fieldId,
          isRequired:
            index < 3 ||
            fieldId === templates.find((template) => template.id === templateId)?.primaryAmountFieldId ||
            fieldId === templates.find((template) => template.id === templateId)?.primaryDateFieldId,
          isVisible: true,
          displayOrder: index + 1,
          defaultValue: ''
        },
        update: {
          isRequired:
            index < 3 ||
            fieldId === templates.find((template) => template.id === templateId)?.primaryAmountFieldId ||
            fieldId === templates.find((template) => template.id === templateId)?.primaryDateFieldId,
          isVisible: true,
          displayOrder: index + 1,
          defaultValue: ''
        }
      });
    }
  }

  const projects = [
    {
      id: 'dp-001',
      name: '太和中转项目',
      customerName: '太和物流',
      description: '中转场地、车辆、人工和杂费综合项目。',
      ownerName: '林雪'
    },
    {
      id: 'dp-002',
      name: '得物项目',
      customerName: '得物',
      description: '电商仓配和运输收入记录项目。',
      ownerName: '陈明'
    },
    {
      id: 'dp-003',
      name: '旧衣服项目',
      customerName: '旧衣回收',
      description: '回收运输、分拣人工、场地费用项目。',
      ownerName: '赵复核'
    }
  ];

  for (const project of projects) {
    await prisma.project.upsert({
      where: {
        id: project.id
      },
      create: {
        ...project,
        status: 'active',
        createdBy: '系统'
      },
      update: {
        name: project.name,
        customerName: project.customerName,
        description: project.description,
        ownerName: project.ownerName,
        status: 'active',
        createdBy: '系统'
      }
    });
  }

  const projectTemplates = [
    ['dp-001', 'dt-transport', '太和运输费用'],
    ['dp-001', 'dt-labor', '太和劳务费用'],
    ['dp-001', 'dt-reimbursement', '太和报销费用'],
    ['dp-001', 'dt-other', '太和其他支出'],
    ['dp-002', 'dt-revenue', '得物收入记录'],
    ['dp-002', 'dt-transport', '得物运输成本'],
    ['dp-002', 'dt-reimbursement', '得物报销费用'],
    ['dp-002', 'dt-other', '得物其他支出'],
    ['dp-003', 'dt-site', '旧衣场地费用'],
    ['dp-003', 'dt-transport', '旧衣运输成本'],
    ['dp-003', 'dt-reimbursement', '旧衣报销费用'],
    ['dp-003', 'dt-other', '旧衣其他支出']
  ] as const;

  for (const [projectId, templateId, customName] of projectTemplates) {
    await prisma.projectTemplate.upsert({
      where: {
        projectId_templateId: {
          projectId,
          templateId
        }
      },
      create: {
        id: `pt-${projectId}-${templateId}`,
        projectId,
        templateId,
        recordType: templates.find((template) => template.id === templateId)!.recordType,
        customName,
        isActive: true
      },
      update: {
        recordType: templates.find((template) => template.id === templateId)!.recordType,
        customName,
        isActive: true
      }
    });
  }

  const demoRecord = await prisma.businessRecord.upsert({
    where: {
      id: 'br-seed-transport-001'
    },
    create: {
      id: 'br-seed-transport-001',
      projectId: 'dp-001',
      templateId: 'dt-transport',
      recordType: DataRecordType.transport,
      recordDate: new Date('2026-07-01'),
      amount: new Prisma.Decimal(8200),
      category: '成本',
      subCategory: '运输费用模板',
      description: '太和运输费用种子记录',
      sourceType: RecordSourceType.manual,
      sourceId: 'manual',
      status: BusinessRecordStatus.pending_confirm,
      attachments: [],
      createdBy: '系统'
    },
    update: {
      projectId: 'dp-001',
      templateId: 'dt-transport',
      recordType: DataRecordType.transport,
      recordDate: new Date('2026-07-01'),
      amount: new Prisma.Decimal(8200),
      category: '成本',
      subCategory: '运输费用模板',
      description: '太和运输费用种子记录',
      sourceType: RecordSourceType.manual,
      sourceId: 'manual',
      status: BusinessRecordStatus.pending_confirm,
      attachments: [],
      createdBy: '系统'
    }
  });

  const demoValues = [
    { fieldId: 'f-date', fieldName: '日期', valueDate: new Date('2026-07-01') },
    { fieldId: 'f-amount', fieldName: '金额', valueNumber: new Prisma.Decimal(8200) },
    { fieldId: 'f-driver', fieldName: '司机', valueText: '王师傅' }
  ];

  for (const value of demoValues) {
    await prisma.recordValue.upsert({
      where: {
        recordId_fieldId: {
          recordId: demoRecord.id,
          fieldId: value.fieldId
        }
      },
      create: {
        recordId: demoRecord.id,
        ...value
      },
      update: value
    });
  }

  const riskRules = [
    {
      id: 'rr-amount-high',
      ruleKey: 'amount_over_20000',
      ruleName: '金额超过20000元',
      ruleType: 'amount_threshold',
      severity: RiskLevel.high,
      conditionJson: { threshold: 20000 },
      description: '单笔工单金额超过20000元时标记为高风险。'
    },
    {
      id: 'rr-amount-medium',
      ruleKey: 'amount_over_8000',
      ruleName: '金额超过8000元',
      ruleType: 'amount_threshold',
      severity: RiskLevel.medium,
      conditionJson: { threshold: 8000 },
      description: '单笔工单金额超过8000元时标记为中风险。'
    },
    {
      id: 'rr-missing-attachment',
      ruleKey: 'expense_missing_attachment',
      ruleName: '高额报销缺少附件',
      ruleType: 'missing_attachment',
      severity: RiskLevel.medium,
      conditionJson: { threshold: 1000, workOrderType: 'expense' },
      description: '报销金额超过1000元且没有附件时提示补充凭证。'
    },
    {
      id: 'rr-duplicate',
      ruleKey: 'duplicate_same_day',
      ruleName: '同日同项目同金额疑似重复',
      ruleType: 'duplicate_submission',
      severity: RiskLevel.medium,
      conditionJson: {},
      description: '同一员工在同项目同一天提交相同金额时提示重复。'
    },
    {
      id: 'rr-after-hours',
      ruleKey: 'submitted_after_hours',
      ruleName: '非工作时间提交',
      ruleType: 'after_hours',
      severity: RiskLevel.low,
      conditionJson: { startHour: 8, endHour: 20, timeZone: 'Asia/Shanghai' },
      description: '北京时间8点前或20点后提交时提示人工关注。'
    },
    {
      id: 'rr-cost-trend',
      ruleKey: 'cost_increasing_7d',
      ruleName: '近7天成本连续升高',
      ruleType: 'cost_trend',
      severity: RiskLevel.medium,
      conditionJson: { windowDays: 7, minimumSamples: 3 },
      description: '同项目最近三笔及当前成本连续升高时提示。'
    }
  ];

  for (const rule of riskRules) {
    await prisma.riskRule.upsert({
      where: { ruleKey: rule.ruleKey },
      create: { ...rule, targetType: 'work_order', isActive: true, createdBy: 'system' },
      update: {
        ruleName: rule.ruleName,
        ruleType: rule.ruleType,
        targetType: 'work_order',
        severity: rule.severity,
        conditionJson: rule.conditionJson,
        description: rule.description,
        isActive: true
      }
    });
  }

  const employee = await prisma.user.findUniqueOrThrow({ where: { username: 'employee' } });
  const pendingWorkOrder = await prisma.workOrder.upsert({
    where: { id: 'wo-seed-boss-pending' },
    create: {
      id: 'wo-seed-boss-pending',
      orderNo: 'WO202607110001',
      type: WorkOrderType.expense,
      projectId: 'dp-001',
      projectName: '太和中转项目',
      customerName: '太和物流',
      creatorId: employee.id,
      creatorName: employee.name,
      amount: new Prisma.Decimal(26000),
      cost: new Prisma.Decimal(26000),
      profit: new Prisma.Decimal(-26000),
      status: WorkOrderStatus.boss_pending,
      riskLevel: RiskLevel.high,
      description: '高额临时人工费用，等待老板审批',
      occurredDate: new Date('2026-07-11'),
      extraValues: { expenseType: '人工' },
      financeOpinion: '凭证基本完整',
      reviewerOpinion: '金额较高，提交规则复核',
      aiSummary: '规则复核发现高额工单异常，建议核对合同与付款依据'
    },
    update: {
      projectId: 'dp-001',
      projectName: '太和中转项目',
      customerName: '太和物流',
      creatorId: employee.id,
      creatorName: employee.name,
      amount: new Prisma.Decimal(26000),
      cost: new Prisma.Decimal(26000),
      profit: new Prisma.Decimal(-26000),
      status: WorkOrderStatus.boss_pending,
      riskLevel: RiskLevel.high,
      description: '高额临时人工费用，等待老板审批',
      occurredDate: new Date('2026-07-11'),
      extraValues: { expenseType: '人工' },
      financeOpinion: '凭证基本完整',
      reviewerOpinion: '金额较高，提交规则复核',
      aiSummary: '规则复核发现高额工单异常，建议核对合同与付款依据',
      generatedRecordId: null,
      completedAt: null
    }
  });

  await prisma.aiAnomaly.upsert({
    where: {
      workOrderId_ruleId: {
        workOrderId: pendingWorkOrder.id,
        ruleId: 'rr-amount-high'
      }
    },
    create: {
      anomalyType: 'amount_threshold',
      ruleId: 'rr-amount-high',
      projectId: pendingWorkOrder.projectId,
      workOrderId: pendingWorkOrder.id,
      riskLevel: RiskLevel.high,
      reason: '工单金额26000元超过阈值20000元',
      suggestion: '请核对合同、凭证和付款依据。',
      evidence: { amount: 26000, threshold: 20000 },
      status: 'open'
    },
    update: {
      riskLevel: RiskLevel.high,
      reason: '工单金额26000元超过阈值20000元',
      suggestion: '请核对合同、凭证和付款依据。',
      evidence: { amount: 26000, threshold: 20000 },
      status: 'open',
      resolvedAt: null
    }
  });

  await prisma.aiModelConfig.upsert({
    where: { id: 'ai-model-mock-default' },
    create: {
      id: 'ai-model-mock-default',
      provider: 'mock',
      modelName: 'mock-structured-v1',
      displayName: '结构化数据 Mock Provider',
      isLocal: true,
      supportsToolCall: false,
      isActive: true,
      createdBy: 'system'
    },
    update: {
      modelName: 'mock-structured-v1',
      displayName: '结构化数据 Mock Provider',
      isLocal: true,
      supportsToolCall: false,
      isActive: true
    }
  });

  await prisma.aiPromptVersion.upsert({
    where: { promptKey_versionNo: { promptKey: 'boss_chat', versionNo: 1 } },
    create: {
      id: 'ai-prompt-boss-chat-v1',
      promptKey: 'boss_chat',
      versionNo: 1,
      title: '老板经营问答 V1',
      systemPrompt:
        '你是物流企业老板的财务运营助手。只能依据工具返回的结构化上下文回答，不得编造金额、项目、工单或人员。工具没有提供答案时回答“需要人工确认”。',
      userPromptTemplate: '用户问题：{{question}}\n工具上下文：{{tool_context}}',
      isActive: true,
      createdBy: 'system'
    },
    update: {
      title: '老板经营问答 V1',
      systemPrompt:
        '你是物流企业老板的财务运营助手。只能依据工具返回的结构化上下文回答，不得编造金额、项目、工单或人员。工具没有提供答案时回答“需要人工确认”。',
      userPromptTemplate: '用户问题：{{question}}\n工具上下文：{{tool_context}}',
      isActive: true
    }
  });

  const modelDeployments = [
    {
      id: 'model-deployment-mock-text',
      deploymentKey: 'mock-text',
      provider: 'mock',
      modelName: 'mock-structured-v1',
      modelVersion: '1',
      endpoint: null,
      secretRef: null,
      taskTypes: ['boss_chat'],
      maxConcurrency: 4,
      timeoutMs: 5000,
      isLocal: true,
      isEnabled: true,
      status: 'healthy' as const
    },
    {
      id: 'model-deployment-qwen-text',
      deploymentKey: 'qwen3-14b-awq',
      provider: 'openai_compatible',
      modelName: 'Qwen/Qwen3-14B-AWQ',
      modelVersion: 'unverified',
      endpoint: 'http://127.0.0.1:8000/v1',
      secretRef: 'AI_API_KEY',
      taskTypes: ['boss_chat', 'structured_extraction', 'risk_explanation'],
      maxConcurrency: 1,
      timeoutMs: 60000,
      isLocal: true,
      isEnabled: false,
      status: 'disabled' as const
    },
    {
      id: 'model-deployment-qwen-vl',
      deploymentKey: 'qwen3-vl-8b-instruct',
      provider: 'openai_compatible',
      modelName: 'Qwen/Qwen3-VL-8B-Instruct',
      modelVersion: 'unverified',
      endpoint: 'http://127.0.0.1:8001/v1',
      secretRef: 'VL_API_KEY',
      taskTypes: ['ocr_ambiguity_review', 'document_vision'],
      maxConcurrency: 1,
      timeoutMs: 90000,
      isLocal: true,
      isEnabled: false,
      status: 'disabled' as const
    },
    {
      id: 'model-deployment-paddle-ocr',
      deploymentKey: 'paddleocr-vl',
      provider: 'local_paddle',
      modelName: 'PaddlePaddle/PaddleOCR-VL',
      modelVersion: 'unverified',
      endpoint: 'http://127.0.0.1:8868',
      secretRef: 'OCR_API_KEY',
      taskTypes: ['ocr_document'],
      maxConcurrency: 1,
      timeoutMs: 60000,
      isLocal: true,
      isEnabled: false,
      status: 'disabled' as const
    },
    {
      id: 'model-deployment-qwen-embedding',
      deploymentKey: 'qwen3-embedding-8b',
      provider: 'openai_compatible',
      modelName: 'Qwen/Qwen3-Embedding-8B',
      modelVersion: 'unverified',
      endpoint: 'http://127.0.0.1:8002/v1',
      secretRef: 'EMBEDDING_API_KEY',
      taskTypes: ['embedding'],
      maxConcurrency: 1,
      timeoutMs: 60000,
      isLocal: true,
      isEnabled: false,
      status: 'disabled' as const
    }
  ];

  for (const deployment of modelDeployments) {
    await prisma.modelDeployment.upsert({
      where: { deploymentKey: deployment.deploymentKey },
      create: deployment,
      update: {
        provider: deployment.provider,
        modelName: deployment.modelName,
        modelVersion: deployment.modelVersion,
        endpoint: deployment.endpoint,
        secretRef: deployment.secretRef,
        taskTypes: deployment.taskTypes,
        maxConcurrency: deployment.maxConcurrency,
        timeoutMs: deployment.timeoutMs,
        isLocal: deployment.isLocal,
        isEnabled: deployment.isEnabled,
        status: deployment.status
      }
    });
  }

  const modelRoutes = [
    ['boss_chat', 'model-deployment-mock-text', 100, true, 'mock'],
    ['boss_chat', 'model-deployment-qwen-text', 10, false, 'manual'],
    ['ocr_document', 'model-deployment-paddle-ocr', 10, false, 'manual'],
    ['ocr_ambiguity_review', 'model-deployment-qwen-vl', 10, false, 'manual'],
    ['embedding', 'model-deployment-qwen-embedding', 10, false, 'manual']
  ] as const;
  for (const [taskType, deploymentId, priority, isEnabled, fallbackPolicy] of modelRoutes) {
    await prisma.taskModelRoute.upsert({
      where: { taskType_deploymentId: { taskType, deploymentId } },
      create: { taskType, deploymentId, priority, isEnabled, fallbackPolicy },
      update: { priority, isEnabled, fallbackPolicy }
    });
  }

  console.log('Phase 10 seed complete: core data, mock AI/OCR, and disabled local model routes are ready.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
