import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  API_FRONTEND_URL,
  isApiResponse,
  login,
  logout,
  readEnvelope,
  selectOption
} from './support/app';

interface ImportTaskDto {
  id: string;
  status: string;
  counts: {
    total: number;
    valid: number;
    errors: number;
    duplicates: number;
    ignored: number;
    imported: number;
  };
}

interface ImportConfirmDto {
  task: ImportTaskDto;
  importedRows: number;
  errorRows: number;
  duplicateRows: number;
  ignoredRows: number;
  alreadyConfirmed: boolean;
}

interface RecordDto {
  id: string;
  importTaskId?: string;
  sourceId: string;
  sourceType: string;
  amount: string;
  status: string;
}

test('API mode: finance cannot partially post an XLSX with blocking row errors', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E Stage9 标准费用导入.xlsx');

  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '运输费用模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/import-tasks'));
  const parsedResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && /\/api\/import-tasks\/[^/]+\/parse$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: '上传并解析' }).click();

  const created = await readEnvelope<ImportTaskDto>(await createdResponse);
  const parsed = await readEnvelope<ImportTaskDto>(await parsedResponse);
  expect(parsed.data.id).toBe(created.data.id);
  expect(parsed.data.status).toBe('mapping');
  expect(parsed.data.counts).toMatchObject({ total: 5, duplicates: 1, ignored: 1 });
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/mapping$`));

  const unknownRow = page.locator('.ant-table-row').filter({ hasText: 'E2E附加费' });
  await expect(unknownRow).toContainText('等待人工处理');
  await unknownRow.locator('.ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '明确忽略此列' }).click();

  const mappingResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'PUT',
    `/api/import-tasks/${created.data.id}/mappings`
  ));
  const previewResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'GET',
    `/api/import-tasks/${created.data.id}/preview`
  ));
  await page.getByRole('button', { name: '下一步确认' }).click();
  const mapped = await readEnvelope<ImportTaskDto>(await mappingResponse);
  const previewHttpResponse = await previewResponse;
  const previewUrl = new URL(previewHttpResponse.url());
  expect(previewUrl.searchParams.get('page')).toBe('1');
  expect(previewUrl.searchParams.get('pageSize')).toBe('20');
  const previewPayload = await readEnvelope<{
    rows: unknown[];
    pagination: { page: number; pageSize: number; total: number };
  }>(previewHttpResponse);
  expect(previewPayload.data.rows.length).toBeLessThanOrEqual(20);
  expect(previewPayload.data.pagination).toMatchObject({ page: 1, pageSize: 20, total: 5 });
  expect(mapped.data.status).toBe('pending_confirm');
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/confirm$`));

  await expect(page.getByText('可入库').first()).toBeVisible();
  await expect(page.getByText('错误行').first()).toBeVisible();
  await expect(page.getByText('重复行').first()).toBeVisible();
  await expect(page.locator('.ant-table-row').filter({ hasText: '可入库' }).first()).toContainText('¥8,765.43');

  const revalidateResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/revalidate`
  ));
  await page.getByRole('button', { name: '重新校验' }).click();
  const validated = await readEnvelope<ImportTaskDto & {
    validation: {
      snapshot: {
        valid: boolean;
        counts: { blockingErrorCount: number; recordCount: number };
      };
    };
  }>(await revalidateResponse);
  expect(validated.data.validation.snapshot).toMatchObject({
    valid: false,
    counts: { blockingErrorCount: expect.any(Number), recordCount: 1 }
  });
  expect(validated.data.validation.snapshot.counts.blockingErrorCount).toBeGreaterThan(0);
  await expect(page.getByText('整批校验未通过')).toBeVisible();
  await expect(page.getByText('上传者不能审批同一导入任务')).toBeVisible();
  await expect(page.getByRole('button', { name: /批准并入库/ })).toBeDisabled();
});

test('API mode: finance preview fetches only the selected server page', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E 预览分页费用导入.xlsx');

  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '运输费用模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/import-tasks'));
  await page.getByRole('button', { name: '上传并解析' }).click();
  const created = await readEnvelope<ImportTaskDto>(await createdResponse);
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/mapping$`));

  const firstPreviewResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'GET',
    `/api/import-tasks/${created.data.id}/preview`
  ));
  await page.getByRole('button', { name: '下一步确认' }).click();
  const firstPreview = await readEnvelope<{
    rows: unknown[];
    pagination: { page: number; pageSize: number; total: number; hasNext: boolean };
  }>(await firstPreviewResponse);
  expect(firstPreview.data.rows).toHaveLength(20);
  expect(firstPreview.data.pagination).toEqual({ page: 1, pageSize: 20, total: 25, totalPages: 2, hasNext: true });
  await expect(page.locator('.ant-table-tbody > tr.ant-table-row')).toHaveCount(20);

  const secondPreviewResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === `/api/import-tasks/${created.data.id}/preview`
      && url.searchParams.get('page') === '2'
      && url.searchParams.get('pageSize') === '20';
  });
  await page.locator('.ant-pagination-next button').click();
  const secondPreview = await readEnvelope<{
    rows: unknown[];
    pagination: { page: number; pageSize: number; total: number; hasNext: boolean };
  }>(await secondPreviewResponse);
  expect(secondPreview.data.rows).toHaveLength(5);
  expect(secondPreview.data.pagination).toMatchObject({ page: 2, pageSize: 20, total: 25, hasNext: false });
  await expect(page.locator('.ant-table-tbody > tr.ant-table-row')).toHaveCount(5);
});

test('API mode: cached formula evidence is approved by a second finance user', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E 公式缓存费用导入.xlsx');

  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '运输费用模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/import-tasks'));
  await page.getByRole('button', { name: '上传并解析' }).click();
  const created = await readEnvelope<ImportTaskDto>(await createdResponse);

  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/mapping$`));
  await expect(page.getByText('已从表格解析路径分离 1 个内嵌媒体对象')).toBeVisible();
  await expect(page.getByText('当前工作表包含 1 个公式单元格')).toBeVisible();
  await page.getByRole('checkbox', { name: '允许使用公式缓存结果' }).check();

  const parsedResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/import-tasks/${created.data.id}/parse`
  ));
  await page.getByRole('button', { name: '解析所选区域' }).click();
  const response = await parsedResponse;
  expect(response.request().postDataJSON()).toMatchObject({ allowCachedFormulaResults: true });
  const parsed = await readEnvelope<ImportTaskDto>(response);
  expect(parsed.data.status).toBe('pending_confirm');
  expect(parsed.data.counts).toMatchObject({ total: 1, valid: 1, errors: 0 });
  await expect(page.getByText('所有列均已有明确处理决定')).toBeVisible();

  const previewResponse = page.waitForResponse((nextResponse) => isApiResponse(
    nextResponse,
    'GET',
    `/api/import-tasks/${created.data.id}/preview`
  ));
  await page.getByRole('button', { name: '下一步确认' }).click();
  await readEnvelope(await previewResponse);
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/confirm$`));
  await expect(page.getByText('上传者不能审批同一导入任务')).toBeVisible();

  await logout(page);
  await login(page, '财务', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import/${created.data.id}/confirm`);
  await expect(page.getByText('导入确认')).toBeVisible();

  const revalidateResponse = page.waitForResponse((nextResponse) => isApiResponse(
    nextResponse,
    'POST',
    `/api/import-tasks/${created.data.id}/revalidate`
  ));
  await page.getByRole('button', { name: '重新校验' }).click();
  const validated = await readEnvelope<ImportTaskDto & {
    validation: {
      snapshot: {
        valid: boolean;
        warnings: Array<{ issueId: string }>;
        counts: { blockingErrorCount: number; recordCount: number };
      };
    };
  }>(await revalidateResponse);
  expect(validated.data.validation.snapshot).toMatchObject({
    valid: true,
    counts: { blockingErrorCount: 0, recordCount: 1 }
  });
  expect(validated.data.validation.snapshot.warnings.length).toBeGreaterThan(0);
  await page.getByRole('checkbox', { name: /已复核当前/ }).check();

  const confirmResponse = page.waitForResponse((nextResponse) => isApiResponse(
    nextResponse,
    'POST',
    `/api/import-tasks/${created.data.id}/confirm`
  ));
  const recordsResponse = page.waitForResponse((nextResponse) => (
    nextResponse.request().method() === 'GET' && new URL(nextResponse.url()).pathname === '/api/records'
  ));
  await page.getByRole('button', { name: '批准并入库 1 条' }).click();
  const confirmed = await readEnvelope<ImportConfirmDto>(await confirmResponse);
  expect(confirmed.data).toMatchObject({
    importedRows: 0,
    errorRows: 0,
    duplicateRows: 0,
    ignoredRows: 0,
    alreadyConfirmed: false,
    task: { status: 'confirming' }
  });

  const records = await readEnvelope<{ items: RecordDto[] }>(await recordsResponse);
  const imported = records.data.items.find((record) => record.importTaskId === created.data.id);
  expect(imported).toMatchObject({
    sourceType: 'excel',
    status: 'confirmed'
  });
  expect(imported?.sourceId).toBeTruthy();
  await expect(page).toHaveURL(new RegExp('/data/records$'));
});

test('API mode: finance uploads a legacy XLS through the data center', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E 旧版费用导入.xls');

  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '运输费用模板');
  const input = page.locator('input[type="file"]');
  await expect(input).toHaveAttribute('accept', /\.xls,/);
  await input.setInputFiles(fixture);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/import-tasks'));
  const parsedResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && /\/api\/import-tasks\/[^/]+\/parse$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: '上传并解析' }).click();

  const created = await readEnvelope<ImportTaskDto>(await createdResponse);
  const parsed = await readEnvelope<ImportTaskDto>(await parsedResponse);
  expect(parsed.data).toMatchObject({
    id: created.data.id,
    counts: { total: 1, valid: 1, errors: 0, duplicates: 0, ignored: 0, imported: 0 }
  });
  expect(['mapping', 'pending_confirm']).toContain(parsed.data.status);
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/mapping$`));
});
