import { DataRecordType, FieldType, PrismaClient, SemanticType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
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
        status: 'active'
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
      description: '记录车辆、司机、线路和运输成本。'
    },
    {
      id: 'dt-labor',
      name: '人工劳务费用模板',
      recordType: DataRecordType.labor,
      description: '记录人员、岗位、工时和单价。'
    },
    {
      id: 'dt-site',
      name: '场地费用模板',
      recordType: DataRecordType.cost,
      description: '记录场地、水电和固定成本。'
    },
    {
      id: 'dt-revenue',
      name: '收入记录模板',
      recordType: DataRecordType.revenue,
      description: '记录票数、吨数和收入金额。'
    },
    {
      id: 'dt-reimbursement',
      name: '报销工单模板',
      recordType: DataRecordType.reimbursement,
      description: '记录报销事由、成本分类、付款对象和凭证。'
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
    'dt-reimbursement': ['f-date', 'f-reason', 'f-cost-category', 'f-amount', 'f-payee', 'f-attachment', 'f-remark']
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
          isRequired: index < 3,
          isVisible: true,
          displayOrder: index + 1,
          defaultValue: ''
        },
        update: {
          isRequired: index < 3,
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
    ['dp-002', 'dt-revenue', '得物收入记录'],
    ['dp-003', 'dt-site', '旧衣场地费用']
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
        customName,
        isActive: true
      },
      update: {
        customName,
        isActive: true
      }
    });
  }

  console.log('Phase 2 seed complete: auth users, templates, fields, and demo projects are ready.');
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
