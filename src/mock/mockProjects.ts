import type { Project } from '@/types/workOrder';

export const mockProjects: Project[] = [
  {
    id: 'dp-001',
    projectName: '太和中转项目',
    customerName: '太和物流',
    ownerName: '陈明',
    monthIncome: 865000,
    monthCost: 612400,
    anomalyCount: 1,
    status: 'normal',
    aiSummary: '客户回款稳定，城配线路利润率健康，油费波动在可接受范围内。',
  },
  {
    id: 'dp-002',
    projectName: '得物项目',
    customerName: '得物',
    ownerName: '陈明',
    monthIncome: 1186000,
    monthCost: 1015000,
    anomalyCount: 3,
    status: 'watch',
    aiSummary: '收入规模较大，但外包承运与夜间装卸费用上升，需要重点压降成本。',
  },
  {
    id: 'dp-003',
    projectName: '旧衣服项目',
    customerName: '旧衣回收',
    ownerName: '陈明',
    monthIncome: 742000,
    monthCost: 486000,
    anomalyCount: 0,
    status: 'normal',
    aiSummary: '回收运输和分拣人工成本稳定，需要继续关注场地费用。',
  },
];
