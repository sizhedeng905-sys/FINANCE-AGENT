import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { moneyToCents } from '../src/utils/money';
import {
  API_FRONTEND_URL,
  isApiResponse,
  login,
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

test('API mode: finance imports a real XLSX with partial-row validation', async ({ page }) => {
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
  await page.getByRole('button', { name: '下一步确认' }).click();
  const mapped = await readEnvelope<ImportTaskDto>(await mappingResponse);
  expect(mapped.data.status).toBe('pending_confirm');
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/confirm$`));

  await expect(page.getByText('可入库').first()).toBeVisible();
  await expect(page.getByText('错误行').first()).toBeVisible();
  await expect(page.getByText('重复行').first()).toBeVisible();

  const confirmResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/confirm`
  ));
  const recordsResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/records'
  ));
  await page.getByRole('button', { name: '确认导入合法行' }).click();

  const confirmed = await readEnvelope<ImportConfirmDto>(await confirmResponse);
  expect(confirmed.data).toMatchObject({
    importedRows: 1,
    errorRows: 2,
    duplicateRows: 1,
    ignoredRows: 1,
    alreadyConfirmed: false
  });
  expect(confirmed.data.task.status).toBe('confirmed');

  const records = await readEnvelope<{ items: RecordDto[] }>(await recordsResponse);
  const imported = records.data.items.find((record) => record.importTaskId === created.data.id);
  expect(imported).toMatchObject({
    sourceType: 'excel',
    amount: '8765.43',
    status: 'confirmed'
  });
  expect(imported?.sourceId).toBeTruthy();
  await expect(page.locator('.ant-table-row').filter({ hasText: '8,765.43' })).toContainText('Excel');

  await page.goto(`${API_FRONTEND_URL}/finance/reports`);
  const reportResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/reports/finance'
      && url.searchParams.get('period') === 'month';
  });
  await page.getByRole('tab', { name: '本月' }).click();
  const report = await readEnvelope<{ totalExpense: string; confirmedRecords: number }>(await reportResponse);
  expect(moneyToCents(report.data.totalExpense) >= moneyToCents('8765.43')).toBeTruthy();
  expect(report.data.confirmedRecords).toBeGreaterThanOrEqual(1);
});

test('API mode: finance explicitly accepts cached formula results before parsing', async ({ page }) => {
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
