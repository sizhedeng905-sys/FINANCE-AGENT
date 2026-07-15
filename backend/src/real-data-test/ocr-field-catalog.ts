export type OcrEvaluationFieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select';

export interface OcrEvaluationField {
  fieldId: string;
  fieldKey: string;
  fieldName: string;
  fieldType: OcrEvaluationFieldType;
  semanticType: string;
  aliases: string[];
}

function field(
  fieldKey: string,
  fieldName: string,
  fieldType: OcrEvaluationFieldType,
  semanticType: string,
  aliases: string[] = []
): OcrEvaluationField {
  return {
    fieldId: `evaluation:${fieldKey}`,
    fieldKey,
    fieldName,
    fieldType,
    semanticType,
    aliases
  };
}

// This catalog contains labels only. Sensitive values remain in ignored local truth files.
export const OCR_EVALUATION_FIELDS: readonly OcrEvaluationField[] = [
  field('record_date', '业务日期', 'date', 'date', ['日期', '发生日期']),
  field('amount', '金额', 'money', 'amount', ['费用金额', '结算金额']),
  field('currency', '币种', 'select', 'currency', ['货币']),
  field('expense_category', '费用类别', 'select', 'category', ['成本分类', '费用类型']),
  field('counterparty', '付款对象', 'text', 'counterparty', ['供应商', '收款方']),
  field('description', '费用事由', 'textarea', 'description', ['说明', '备注']),
  field('driver', '司机', 'text', 'person_name', ['司机姓名']),
  field('vehicle_plate', '车牌号', 'text', 'vehicle_plate', ['车辆', '车牌']),
  field('ticket_count', '票数', 'number', 'quantity', ['件数']),
  field('weight', '重量', 'number', 'weight', ['吨数']),
  field('unit_price', '单价', 'money', 'unit_price', ['计费单价']),
  field('route', '线路', 'text', 'route', ['运输线路']),
  field('work_hours', '工时', 'number', 'duration', ['工作时长']),
  field('attendance', '出勤', 'number', 'quantity', ['出勤天数']),
  field('invoice_number', '发票号码', 'text', 'invoice_number', ['票据号码', '发票号']),
  field('invoice_date', '开票日期', 'date', 'date', ['发票日期']),
  field('tax_inclusive_amount', '含税金额', 'money', 'amount', ['价税合计']),
  field('tax_amount', '税额', 'money', 'amount', ['合计税额']),
  field('seller', '销方', 'text', 'counterparty', ['销售方', '销方名称']),
  field('item_description', '购买内容', 'textarea', 'description', ['货物或应税劳务名称', '项目名称'])
] as const;

export const OCR_KEY_FIELD_KEYS = new Set([
  'record_date',
  'amount',
  'invoice_number',
  'invoice_date',
  'tax_inclusive_amount',
  'tax_amount',
  'seller'
]);
