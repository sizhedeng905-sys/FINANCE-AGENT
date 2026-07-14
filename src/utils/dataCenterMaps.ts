import type { DataRecordType, FieldDefinition, ImportTask, Project, BusinessRecord, FieldSuggestion, OCRTaskStatus } from '@/types/dataCenter';

export const recordTypeMap: Record<DataRecordType, string> = {
  cost: '成本',
  revenue: '收入',
  reimbursement: '报销',
  transport: '运输',
  labor: '人工',
  other: '其他',
};

export const fieldTypeMap: Record<FieldDefinition['fieldType'], string> = {
  text: '文本',
  number: '数字',
  money: '金额',
  date: '日期',
  select: '下拉',
  file: '附件',
  textarea: '多行文本',
};

export const semanticTypeMap: Record<FieldDefinition['semanticType'], string> = {
  amount: '金额',
  date: '日期',
  person: '人员',
  vehicle: '车辆',
  project: '项目',
  location: '地点',
  category: '分类',
  remark: '备注',
  file: '文件',
};

export const projectStatusMap: Record<Project['status'], string> = {
  active: '启用',
  archived: '已归档',
};

export const recordStatusMap: Record<BusinessRecord['status'], string> = {
  draft: '草稿',
  pending_confirm: '待确认',
  confirmed: '已确认',
  rejected: '已作废',
};

export const sourceTypeMap: Record<BusinessRecord['sourceType'], string> = {
  manual: '手工',
  excel: 'Excel',
  ocr: 'OCR',
  work_order: '工单',
};

export const importStatusMap: Record<ImportTask['status'], string> = {
  uploaded: '已上传',
  parsing: '解析中',
  parsed: '已解析',
  mapping: '待映射',
  pending_confirm: '待确认',
  confirmed: '已确认',
  failed: '失败',
  cancelled: '已取消',
};

export const suggestionStatusMap: Record<FieldSuggestion['status'], string> = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已拒绝',
  mapped_to_existing: '已映射',
};

export const ocrStatusMap: Record<OCRTaskStatus, string> = {
  uploaded: '已上传',
  queued: '排队中',
  processing: '识别中',
  pending_confirm: '待人工确认',
  confirmed: '已确认',
  failed: '识别失败',
  cancelled: '已取消',
};
