import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  API_FRONTEND_URL,
  isApiResponse,
  login,
  readEnvelope,
  selectOption
} from './support/app';

interface OcrTaskDto {
  id: string;
  status: string;
  extractedText: string;
  fields: Array<{ fieldId: string; fieldName: string; normalizedValue: unknown; corrected: boolean }>;
}

interface RecordDto {
  id: string;
  sourceType: string;
  sourceId: string;
  amount: number;
  status: string;
}

test('API mode: finance corrects OCR evidence before creating a business record', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E OCR 标准票据.pdf');

  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/ocr`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '报销工单模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const uploadResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/files/upload'));
  const createResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/ocr-tasks'));
  const runResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && /\/api\/ocr-tasks\/[^/]+\/run$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: '上传并识别' }).click();
  await readEnvelope(await uploadResponse);
  const created = await readEnvelope<OcrTaskDto>(await createResponse);
  const recognized = await readEnvelope<OcrTaskDto>(await runResponse);
  expect(recognized.data).toMatchObject({ id: created.data.id, status: 'pending_confirm' });
  expect(recognized.data.extractedText).toContain('金额');
  await expect(page).toHaveURL(new RegExp(`/data/ocr/${created.data.id}$`));

  const amountRow = page.locator('.ant-table-row').filter({ hasText: '金额' }).first();
  await expect(amountRow).toContainText('1280.5');
  await amountRow.getByRole('button', { name: '修正' }).click();
  const dialog = page.getByRole('dialog', { name: /修正字段：金额/ });
  await dialog.getByLabel('修正值').fill('1366.66');
  await dialog.getByLabel('修正原因').fill('E2E人工核对票据金额');

  const correctionResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'PUT',
    `/api/ocr-tasks/${created.data.id}/corrections`
  ));
  await dialog.getByRole('button', { name: '保存修正' }).click();
  const corrected = await readEnvelope<OcrTaskDto>(await correctionResponse);
  expect(corrected.data.fields.find((field) => field.fieldName === '金额')).toMatchObject({
    normalizedValue: 1366.66,
    corrected: true
  });
  await expect(dialog).toBeHidden();

  const confirmResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/ocr-tasks/${created.data.id}/confirm`
  ));
  const recordsResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/records'
  ));
  await page.getByRole('button', { name: '确认并生成经营记录' }).click();
  const confirmed = await readEnvelope<{ task: OcrTaskDto; record: RecordDto; alreadyConfirmed: boolean }>(await confirmResponse);
  expect(confirmed.data).toMatchObject({
    task: { status: 'confirmed' },
    record: { sourceType: 'ocr', sourceId: created.data.id, amount: 1366.66, status: 'confirmed' },
    alreadyConfirmed: false
  });

  const records = await readEnvelope<{ items: RecordDto[] }>(await recordsResponse);
  expect(records.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceType: 'ocr', sourceId: created.data.id, amount: 1366.66 })
  ]));
  await expect(page.locator('.ant-table-row').filter({ hasText: '1,366.66' })).toContainText('OCR');
});
