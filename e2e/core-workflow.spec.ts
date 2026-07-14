import { expect, test } from '@playwright/test';
import {
  API_FRONTEND_URL,
  chinaDate,
  completeApprovalModal,
  isApiResponse,
  login,
  logout,
  readEnvelope,
  selectOption
} from './support/app';

interface WorkOrderDto {
  id: string;
  orderNo: string;
  status: string;
  aiSummary?: string;
  generatedRecordId?: string;
}

interface RecordDto {
  id: string;
  amount: number;
  sourceId: string;
  status: string;
}

test('API mode: employee submission reaches a confirmed record and boss report', async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const description = `E2E D workflow ${suffix}`;
  const amount = 4321.09;

  await login(page, 'employee', '/employee/home');
  await page.goto(`${API_FRONTEND_URL}/work-orders/create`);
  await selectOption(page, '项目', '太和中转项目');
  await page.getByLabel('发生日期').fill(chinaDate());
  await page.getByLabel('发生日期').press('Enter');
  await page.getByLabel('申请金额（元）').fill(String(amount));
  await selectOption(page, '费用类型', '办公');
  await page.getByLabel('事由说明').fill(description);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/work-orders'));
  const submittedResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && /\/api\/work-orders\/[^/]+\/submit$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: /提交审核/ }).click();

  const created = await readEnvelope<WorkOrderDto>(await createdResponse);
  const submitted = await readEnvelope<WorkOrderDto>(await submittedResponse);
  expect(submitted.data.id).toBe(created.data.id);
  expect(submitted.data.status).toBe('finance_reviewing');
  await expect(page).toHaveURL(/\/work-orders\/my$/);

  const workOrderId = created.data.id;
  await logout(page);
  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/work-orders/${workOrderId}`);
  await expect(page.getByText(description)).toBeVisible();

  const financeResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/work-orders/${workOrderId}/finance-review`
  ));
  await page.getByRole('button', { name: /^通\s*过$/ }).click();
  await completeApprovalModal(page, '财务通过', `E2E finance approved ${suffix}`);
  expect((await readEnvelope<WorkOrderDto>(await financeResponse)).data.status).toBe('reviewer_reviewing');

  await logout(page);
  await login(page, 'reviewer', '/reviewer/home');
  await page.goto(`${API_FRONTEND_URL}/work-orders/${workOrderId}`);
  const reviewerResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/work-orders/${workOrderId}/reviewer-review`
  ));
  await page.getByRole('button', { name: /复核通过/ }).click();
  await completeApprovalModal(page, '复核通过', `E2E reviewer approved ${suffix}`);
  const reviewed = await readEnvelope<WorkOrderDto>(await reviewerResponse);
  expect(reviewed.data.status).toBe('boss_pending');
  expect(reviewed.data.aiSummary).toMatch(/规则复核/);

  await logout(page);
  await login(page, 'boss', '/boss/home');
  await page.goto(`${API_FRONTEND_URL}/work-orders/${workOrderId}`);
  const bossResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/work-orders/${workOrderId}/boss-approve`
  ));
  await page.getByRole('button', { name: '最终通过' }).click();
  await completeApprovalModal(page, '最终通过', `E2E boss approved ${suffix}`);
  const completed = await readEnvelope<WorkOrderDto>(await bossResponse);
  expect(completed.data.status).toBe('completed');
  expect(completed.data.generatedRecordId).toBeTruthy();

  const recordsResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/records'
  ));
  await page.goto(`${API_FRONTEND_URL}/boss/data/records`);
  const records = await readEnvelope<{ items: RecordDto[] }>(await recordsResponse);
  const generated = records.data.items.find((item) => item.id === completed.data.generatedRecordId);
  expect(generated, `record generated from work order ${workOrderId}`).toMatchObject({
    amount,
    sourceId: workOrderId,
    status: 'confirmed'
  });
  const recordRow = page.locator('.ant-table-row').filter({ hasText: '4,321.09' });
  await expect(recordRow).toContainText('太和中转项目');
  await expect(recordRow).toContainText('已确认');

  const reportResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/reports/boss'
  ));
  await page.goto(`${API_FRONTEND_URL}/boss/reports`);
  const report = await readEnvelope<{ expense: number; recordCount: number }>(await reportResponse);
  expect(report.data.expense).toBeGreaterThanOrEqual(amount);
  expect(report.data.recordCount).toBeGreaterThanOrEqual(1);
  const expenseMetric = page.locator('.metric-card').filter({ hasText: '确认支出' });
  await expect(expenseMetric).toContainText('4,321.09');
  await expect(page.getByText('项目利润排行', { exact: true })).toBeVisible();
});
