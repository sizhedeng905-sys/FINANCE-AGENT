import type { OCRTask } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function createOCRTask(payload: Partial<OCRTask>) {
  await delay();
  return ok({ ...payload, id: `ocr-${Date.now()}`, status: 'uploaded' } as OCRTask, 'OCR任务已创建');
}

export async function getOCRTask(id: string) {
  await delay();
  return ok({
    id,
    rawFileId: 'rf-ocr',
    projectId: 'dp-001',
    templateId: 'dt-reimbursement',
    status: 'pending_confirm',
    extractedText: '发票金额 1200 元，付款对象 临时仓库。',
    extractedFields: { 金额: 1200, 付款对象: '临时仓库' },
    createdAt: new Date().toISOString(),
  } as OCRTask);
}

export async function confirmOCRTask(id: string) {
  await delay();
  return ok({ id, status: 'confirmed' }, 'OCR结果已确认');
}
