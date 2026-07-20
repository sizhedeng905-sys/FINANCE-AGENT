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
  rawFileId: string;
  status: string;
  version: number;
  reviewRevision: number;
  extractedText: string;
  fields: Array<{
    fieldId: string;
    fieldName: string;
    normalizedValue: unknown;
    corrected: boolean;
    evidenceRefs: string[];
  }>;
  validation: null | {
    reviewRevision: number;
    snapshot: { valid: boolean; blockingErrors: unknown[] };
  };
}

interface RecordDto {
  id: string;
  sourceType: string;
  sourceId: string;
  amount: string;
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

  const createResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/ocr-tasks/upload'));
  const runResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && /\/api\/ocr-tasks\/[^/]+\/run$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: '上传并识别' }).click();
  const created = await readEnvelope<OcrTaskDto>(await createResponse);
  const queued = await readEnvelope<OcrTaskDto>(await runResponse);
  expect(queued.data).toMatchObject({ id: created.data.id, status: 'queued' });
  await expect(page).toHaveURL(new RegExp(`/data/ocr/${created.data.id}$`));

  const amountRow = page.locator('.ant-table-row').filter({ hasText: '金额' }).first();
  await expect(amountRow).toBeVisible({ timeout: 30_000 });
  await expect(amountRow).toContainText('1280.5');

  const aiResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/ocr-tasks/${created.data.id}/ai-suggestions`
  ));
  await page.getByRole('button', { name: /生成 AI 建议/ }).first().click();
  const aiSuggestion = await readEnvelope<{ mode: string; mock: boolean; businessRecordsCreated: number }>(await aiResponse);
  expect(aiSuggestion.data).toMatchObject({ mode: 'suggest', mock: true, businessRecordsCreated: 0 });
  await expect(page.getByRole('tab', { name: 'AI建议' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Mock（仅测试）')).toBeVisible();
  await expect(page.getByText('AI 结果仅为建议，不会自动应用、批准或入账')).toBeVisible();
  await expect(page.locator('.ant-tabs-tabpane-active .ant-table-row').filter({ hasText: '金额' }).first()).toBeVisible();

  await page.getByRole('tab', { name: '结构化字段' }).click();

  const previewResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'GET',
    `/api/files/${created.data.rawFileId}/preview`
  ));
  await amountRow.getByRole('button', { name: '查看证据' }).click();
  await expect(page.getByRole('tab', { name: '证据定位' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ocr-evidence-stage canvas')).toBeVisible();
  await expect(page.locator('.ocr-evidence-box')).toBeVisible();
  await previewResponse;

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStage = await page.locator('.ocr-evidence-stage').boundingBox();
  expect(mobileStage).not.toBeNull();
  expect(mobileStage!.x).toBeGreaterThanOrEqual(0);
  expect(mobileStage!.x + mobileStage!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('.ocr-evidence-box')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('tab', { name: '结构化字段' }).click();
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
    normalizedValue: '1366.66',
    corrected: true
  });
  expect(corrected.data.reviewRevision).toBe(1);
  expect(corrected.data.validation).toBeNull();
  await expect(dialog).toBeHidden();

  const confirmButton = page.getByRole('button', { name: '确认并生成经营记录' });
  await expect(confirmButton).toBeDisabled();
  const revalidateResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/ocr-tasks/${created.data.id}/revalidate`
  ));
  await page.getByRole('button', { name: '重新校验' }).click();
  const revalidated = await readEnvelope<OcrTaskDto>(await revalidateResponse);
  expect(revalidated.data.validation).toMatchObject({ reviewRevision: 1, snapshot: { valid: true, blockingErrors: [] } });
  await expect(confirmButton).toBeEnabled();

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
    record: { sourceType: 'ocr', sourceId: created.data.id, amount: '1366.66', status: 'confirmed' },
    alreadyConfirmed: false
  });

  const records = await readEnvelope<{ items: RecordDto[] }>(await recordsResponse);
  expect(records.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceType: 'ocr', sourceId: created.data.id, amount: '1366.66' })
  ]));
  await expect(page.locator('.ant-table-row').filter({ hasText: '1,366.66' })).toContainText('OCR');
});
