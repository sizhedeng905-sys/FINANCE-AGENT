export function createSystemFieldName(fieldName?: string) {
  const clean = (fieldName || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fa5]/g, '');
  return clean ? `field_${clean}` : `field_${Date.now()}`;
}
