import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { canonicalJsonSha256 } from '../backend/src/common/utils/canonical-json';
import {
  reportSnapshotHashInput,
  type CanonicalReportSnapshot
} from '../backend/src/reports/report-snapshot.contract';
import { moneyToCents } from '../src/utils/money';
import {
  API_FRONTEND_URL,
  chinaDate,
  isApiResponse,
  login,
  logout,
  readEnvelope,
  selectOption
} from './support/app';

const API_URL = 'http://127.0.0.1:3101/api';
const EXPECTED_AMOUNTS = ['1250.25', '3406.53', '8765.43'];
const EXPECTED_TOTAL_CENTS = EXPECTED_AMOUNTS.reduce(
  (sum, amount) => sum + moneyToCents(amount),
  0n
);

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

interface ImportTaskDto {
  id: string;
  projectId: string;
  status: string;
  version: number;
  reviewRevision: number;
  counts: {
    total: number;
    valid: number;
    errors: number;
    duplicates: number;
    ignored: number;
    imported: number;
  };
}

interface ImportPreviewRow {
  id: string;
  rowNumber: number;
  amount?: string;
  warnings: string[];
}

interface RecordDto {
  id: string;
  importTaskId?: string;
  sourceId: string;
  sourceType: string;
  amount: string;
  status: string;
}

interface ProjectSummaryDto {
  recordCount: number;
  totalCost: string;
}

interface ProjectStructureDto {
  records: RecordDto[];
}

interface BossReportDto {
  expense: string;
  recordCount: number;
}

interface ReportSnapshotResult {
  snapshot: CanonicalReportSnapshot;
  reused: boolean;
  sourceCount: number;
}

interface SnapshotSourceDto {
  recordId: string;
  recordVersion: number;
  recordHash: string;
  amount: string;
}

async function apiEnvelope<T>(response: APIResponse, expectedStatus = 200): Promise<ApiEnvelope<T>> {
  expect(response.status(), response.url()).toBe(expectedStatus);
  const body = await response.json() as ApiEnvelope<T>;
  expect(body.code).toBe(0);
  expect(body.message).toBe('success');
  return body;
}

async function apiLogin(request: APIRequestContext, username: string) {
  const response = await request.post(`${API_URL}/auth/login`, {
    data: { username, password: '123456' }
  });
  const body = await apiEnvelope<{ accessToken: string }>(response);
  return body.data.accessToken;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function deterministicImportRecordId(importRowId: string) {
  const hex = createHash('sha256').update(`excel-import-record:${importRowId}`).digest('hex').slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}`;
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const normalized = `${versioned}${variant}${hex.slice(17)}`;
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20)
  ].join('-');
}

function cnyCost(snapshot: CanonicalReportSnapshot) {
  return snapshot.metrics.byCurrency.find((item) => item.currency === 'CNY')?.cost ?? '0.00';
}

test('Friday demo: a reviewed Excel reaches official records and a grounded operating snapshot', async ({
  page,
  request
}) => {
  test.setTimeout(180_000);
  const fixture = resolve(
    import.meta.dirname,
    '../backend/test-uploads/e2e-fixtures/E2E 周五演示费用导入.xlsx'
  );
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const financeAToken = await apiLogin(request, 'finance');
  const financeBToken = await apiLogin(request, '财务');
  const bossToken = await apiLogin(request, 'boss');

  const projects = await apiEnvelope<{ items: Array<{ id: string; name: string }> }>(await request.get(
    `${API_URL}/projects?page=1&pageSize=100&status=active`,
    { headers: bearer(financeAToken) }
  ));
  const project = projects.data.items.find((item) => item.name === '太和中转项目');
  expect(project, 'the seeded demo project should exist').toBeTruthy();
  const projectId = project!.id;

  const baselineSummary = await apiEnvelope<ProjectSummaryDto>(await request.get(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/summary`,
    { headers: bearer(financeAToken) }
  ));
  const baselineStructure = await apiEnvelope<ProjectStructureDto>(await request.get(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/structure`,
    { headers: bearer(financeAToken) }
  ));
  const baselineReport = await apiEnvelope<BossReportDto>(await request.get(
    `${API_URL}/reports/boss?period=daily&date=${chinaDate()}`,
    { headers: bearer(bossToken) }
  ));
  const baselineSnapshot = await apiEnvelope<ReportSnapshotResult>(await request.post(
    `${API_URL}/reports/snapshots`,
    {
      headers: bearer(bossToken),
      data: { reportType: 'DAILY', date: chinaDate() }
    }
  ), 201);

  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '运输费用模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/import-tasks'));
  await page.getByRole('button', { name: '上传并解析' }).click();
  const created = await readEnvelope<ImportTaskDto>(await createdResponse);
  expect(created.data.projectId).toBe(projectId);
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/mapping$`));

  const regionCard = page.locator('.ant-card').filter({ hasText: '选择导入区域' });
  await regionCard.locator('.ant-select').nth(0).click();
  await page.locator('.ant-select-item-option').filter({ hasText: '周五演示费用明细' }).click();
  await regionCard.locator('.ant-select').nth(1).click();
  await page.locator('.ant-select-item-option').filter({ hasText: '第 1 行' }).click();
  await expect(page.getByText('当前工作表包含 1 个公式单元格')).toBeVisible();
  await page.getByRole('checkbox', { name: '允许使用公式缓存结果' }).check();

  const parsedResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/parse`
  ));
  await page.getByRole('button', { name: '解析所选区域' }).click();
  const parsed = await readEnvelope<ImportTaskDto>(await parsedResponse);
  expect(parsed.data.status).toBe('pending_confirm');
  expect(parsed.data.counts).toMatchObject({ total: 3, valid: 3, errors: 0, duplicates: 0, ignored: 0 });
  await expect(page.getByText('所有列均已有明确处理决定')).toBeVisible();

  const previewResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'GET',
    `/api/import-tasks/${created.data.id}/preview`
  ));
  await page.getByRole('button', { name: '下一步确认' }).click();
  const preview = await readEnvelope<{
    rows: ImportPreviewRow[];
    pagination: { total: number };
  }>(await previewResponse);
  expect(preview.data.pagination.total).toBe(3);
  expect(preview.data.rows.map((row) => row.amount).sort()).toEqual(EXPECTED_AMOUNTS);
  expect(preview.data.rows.some((row) => row.warnings.some((warning) => warning.includes('公式缓存结果'))))
    .toBe(true);
  await expect(page.getByText('上传者不能审批同一导入任务')).toBeVisible();
  await expect(page.getByRole('button', { name: /批准并入库/ })).toBeDisabled();

  const unpublishedRecords = await apiEnvelope<{ items: RecordDto[]; total: number }>(await request.get(
    `${API_URL}/records?importTaskId=${encodeURIComponent(created.data.id)}&page=1&pageSize=20`,
    { headers: bearer(financeAToken) }
  ));
  expect(unpublishedRecords.data).toMatchObject({ items: [], total: 0 });

  const beforeApprovalSummary = await apiEnvelope<ProjectSummaryDto>(await request.get(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/summary`,
    { headers: bearer(financeAToken) }
  ));
  expect(beforeApprovalSummary.data.recordCount).toBe(baselineSummary.data.recordCount);
  expect(beforeApprovalSummary.data.totalCost).toBe(baselineSummary.data.totalCost);
  const beforeApprovalStructure = await apiEnvelope<ProjectStructureDto>(await request.get(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/structure`,
    { headers: bearer(financeAToken) }
  ));
  expect(beforeApprovalStructure.data.records.map((record) => record.id).sort())
    .toEqual(baselineStructure.data.records.map((record) => record.id).sort());
  const beforeApprovalReport = await apiEnvelope<BossReportDto>(await request.get(
    `${API_URL}/reports/boss?period=daily&date=${chinaDate()}`,
    { headers: bearer(bossToken) }
  ));
  expect(beforeApprovalReport.data).toMatchObject({
    expense: baselineReport.data.expense,
    recordCount: baselineReport.data.recordCount
  });

  for (const row of preview.data.rows) {
    const recordId = deterministicImportRecordId(row.id);
    const deniedResponses = [
      await request.get(`${API_URL}/records/${recordId}`, { headers: bearer(financeAToken) }),
      await request.patch(`${API_URL}/records/${recordId}`, {
        headers: { ...bearer(financeAToken), 'Idempotency-Key': `demo-hidden-patch-${suffix}-${row.rowNumber}` },
        data: { description: 'must remain unpublished' }
      }),
      await request.post(`${API_URL}/records/${recordId}/confirm`, {
        headers: { ...bearer(financeAToken), 'Idempotency-Key': `demo-hidden-confirm-${suffix}-${row.rowNumber}` }
      }),
      await request.delete(`${API_URL}/records/${recordId}`, { headers: bearer(financeAToken) })
    ];
    for (const response of deniedResponses) {
      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({ code: 40401, message: '资源不存在', data: {} });
    }
  }

  await logout(page);
  await login(page, '财务', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import/${created.data.id}/confirm`);
  await expect(page.getByText('导入确认')).toBeVisible();

  const revalidateResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/revalidate`
  ));
  await page.getByRole('button', { name: '重新校验' }).click();
  const revalidated = await readEnvelope<ImportTaskDto & {
    validation: {
      snapshot: {
        valid: boolean;
        warnings: Array<{ issueId: string }>;
        counts: { blockingErrorCount: number; recordCount: number };
      };
    };
  }>(await revalidateResponse);
  expect(revalidated.data.validation.snapshot).toMatchObject({
    valid: true,
    counts: { blockingErrorCount: 0, recordCount: 3 }
  });
  expect(revalidated.data.validation.snapshot.warnings.length).toBeGreaterThan(0);
  await page.getByRole('checkbox', { name: /已复核当前/ }).check();

  const confirmResponsePromise = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/confirm`
  ));
  const recordsResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname === '/api/records'
      && url.searchParams.get('importTaskId') === created.data.id;
  });
  await page.getByRole('button', { name: '批准并入库 3 条' }).click();
  const confirmResponse = await confirmResponsePromise;
  const firstConfirmation = await readEnvelope<{
    task: ImportTaskDto;
    importedRows: number;
    alreadyConfirmed: boolean;
  }>(confirmResponse);
  expect(firstConfirmation.data).toMatchObject({
    importedRows: 0,
    alreadyConfirmed: false,
    task: { id: created.data.id, status: 'confirming' }
  });

  const confirmHeaders = await confirmResponse.request().allHeaders();
  const idempotencyKey = confirmHeaders['idempotency-key'];
  expect(idempotencyKey).toBeTruthy();
  const replayResponse = await request.post(`${API_URL}/import-tasks/${created.data.id}/confirm`, {
    headers: { ...bearer(financeBToken), 'Idempotency-Key': idempotencyKey! },
    data: confirmResponse.request().postDataJSON()
  });
  const replay = await apiEnvelope<{
    task: ImportTaskDto;
    importedRows: number;
    alreadyConfirmed: boolean;
  }>(replayResponse, 201);
  expect(replay.data).toEqual(firstConfirmation.data);

  await expect(page).toHaveURL(new RegExp(`/data/records\\?importTaskId=${encodeURIComponent(created.data.id)}$`));
  await readEnvelope(await recordsResponsePromise);
  await expect(page.getByText('仅显示该导入任务生成的正式记录')).toBeVisible();
  await expect(page.locator('.ant-table-row').filter({ hasText: '1,250.25' })).toBeVisible();

  await expect.poll(async () => {
    const task = await apiEnvelope<ImportTaskDto>(await request.get(
      `${API_URL}/import-tasks/${created.data.id}`,
      { headers: bearer(financeBToken) }
    ));
    return task.data.status;
  }, { timeout: 30_000 }).toBe('confirmed');

  await page.getByRole('button', { name: '查看批准证据' }).click();
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/confirm$`));
  const approvalCard = page.locator('.ant-card').filter({ hasText: '不可变批准快照' });
  await expect(approvalCard).toBeVisible();
  await expect(approvalCard).toContainText('财务');
  await expect(approvalCard).toContainText('3 条');
  await approvalCard.getByRole('button', { name: '查看本批正式记录' }).click();
  await expect(page).toHaveURL(new RegExp(`/data/records\\?importTaskId=${encodeURIComponent(created.data.id)}$`));

  const finalRecords = await apiEnvelope<{ items: RecordDto[]; total: number }>(await request.get(
    `${API_URL}/records?importTaskId=${encodeURIComponent(created.data.id)}&page=1&pageSize=20`,
    { headers: bearer(financeBToken) }
  ));
  expect(finalRecords.data.total).toBe(3);
  expect(finalRecords.data.items.map((record) => record.amount).sort()).toEqual(EXPECTED_AMOUNTS);
  expect(finalRecords.data.items.every((record) => (
    record.importTaskId === created.data.id
      && record.sourceType === 'excel'
      && record.status === 'confirmed'
  ))).toBe(true);

  const repeatedRead = await apiEnvelope<{ items: RecordDto[]; total: number }>(await request.get(
    `${API_URL}/records?importTaskId=${encodeURIComponent(created.data.id)}&page=1&pageSize=20`,
    { headers: bearer(financeBToken) }
  ));
  expect(repeatedRead.data).toEqual(finalRecords.data);

  const finalSummary = await apiEnvelope<ProjectSummaryDto>(await request.get(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/summary`,
    { headers: bearer(financeBToken) }
  ));
  expect(finalSummary.data.recordCount - baselineSummary.data.recordCount).toBe(3);
  expect(moneyToCents(finalSummary.data.totalCost) - moneyToCents(baselineSummary.data.totalCost))
    .toBe(EXPECTED_TOTAL_CENTS);
  const finalStructure = await apiEnvelope<ProjectStructureDto>(await request.get(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/structure`,
    { headers: bearer(financeBToken) }
  ));
  expect(finalStructure.data.records.length - baselineStructure.data.records.length).toBe(3);
  const finalRecordIds = new Set(finalRecords.data.items.map((record) => record.id));
  expect(finalStructure.data.records.filter((record) => finalRecordIds.has(record.id))).toHaveLength(3);

  await logout(page);
  await login(page, 'boss', '/boss/home');
  await page.goto(`${API_FRONTEND_URL}/boss/reports`);
  await expect(page.getByText('项目利润排行', { exact: true })).toBeVisible();
  const finalReport = await apiEnvelope<BossReportDto>(await request.get(
    `${API_URL}/reports/boss?period=daily&date=${chinaDate()}`,
    { headers: bearer(bossToken) }
  ));
  expect(finalReport.data.recordCount - baselineReport.data.recordCount).toBe(3);
  expect(moneyToCents(finalReport.data.expense) - moneyToCents(baselineReport.data.expense))
    .toBe(EXPECTED_TOTAL_CENTS);

  const snapshotResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    '/api/reports/snapshots'
  ));
  await page.getByRole('button', { name: '生成审计快照' }).click();
  const finalSnapshot = await readEnvelope<ReportSnapshotResult>(await snapshotResponse);
  expect(finalSnapshot.data.sourceCount - baselineSnapshot.data.sourceCount).toBe(3);
  expect(moneyToCents(cnyCost(finalSnapshot.data.snapshot)) - moneyToCents(cnyCost(baselineSnapshot.data.snapshot)))
    .toBe(EXPECTED_TOTAL_CENTS);
  expect(finalSnapshot.data.snapshot.metrics.recordCount).toBe(finalSnapshot.data.sourceCount);

  const snapshotSources = await apiEnvelope<{
    items: SnapshotSourceDto[];
    total: number;
  }>(await request.get(
    `${API_URL}/reports/snapshots/${finalSnapshot.data.snapshot.snapshotId}/sources?page=1&pageSize=100`,
    { headers: bearer(bossToken) }
  ));
  expect(snapshotSources.data.total).toBe(finalSnapshot.data.sourceCount);
  const sourceRecordIds = new Set(snapshotSources.data.items.map((item) => item.recordId));
  expect(finalRecords.data.items.every((record) => sourceRecordIds.has(record.id))).toBe(true);
  const sourceDigest = canonicalJsonSha256(
    [...snapshotSources.data.items]
      .sort((first, second) => first.recordId.localeCompare(second.recordId))
      .map((source) => ({
        recordId: source.recordId,
        recordVersion: source.recordVersion,
        recordHash: source.recordHash
      }))
  );
  expect(sourceDigest).toBe(finalSnapshot.data.snapshot.sourceDigest);
  const { snapshotHash, ...snapshotWithoutHash } = finalSnapshot.data.snapshot;
  expect(canonicalJsonSha256(reportSnapshotHashInput(snapshotWithoutHash))).toBe(snapshotHash);
  await expect(page.getByText(snapshotHash, { exact: true })).toBeVisible();
  await expect(page.getByText('来源记录', { exact: true })).toBeVisible();
});
