import { expect, test } from '@playwright/test';
import { moneyToCents } from '../src/utils/money';
import {
  API_FRONTEND_URL,
  chinaDate,
  completeApprovalModal,
  isApiResponse,
  login,
  logout,
  readApiEnvelope,
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
  amount: string;
  sourceId: string;
  status: string;
}

test('API mode: employee submission reaches a confirmed record and boss report', async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const description = `E2E D workflow ${suffix}`;
  const amount = '4321.09';

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
  const report = await readEnvelope<{ expense: string; recordCount: number }>(await reportResponse);
  expect(moneyToCents(report.data.expense) >= moneyToCents(amount)).toBeTruthy();
  expect(report.data.recordCount).toBeGreaterThanOrEqual(1);
  const expenseMetric = page.locator('.metric-card').filter({ hasText: '确认支出' });
  await expect(expenseMetric).toContainText('4,321.09');
  await expect(page.getByText('项目利润排行', { exact: true })).toBeVisible();

  const snapshotResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/reports/snapshots'
  ));
  const snapshotSourcesResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && /\/api\/reports\/snapshots\/[^/]+\/sources$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: '生成审计快照' }).click();
  const snapshot = await readEnvelope<{
    snapshot: { snapshotId: string; snapshotHash: string; warnings: Array<{ code: string }> };
    sourceCount: number;
  }>(await snapshotResponse);
  expect(snapshot.data.snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot.data.sourceCount).toBeGreaterThanOrEqual(1);
  const snapshotSources = await readEnvelope<{
    items: Array<{
      projectName: string;
      recordHash: string;
      accountingDirection: string;
      amount: string;
      currency: string;
    }>;
    total: number;
    snapshot: { snapshotId: string; snapshotHash: string; sourceDigest: string };
  }>(await snapshotSourcesResponse);
  expect(snapshotSources.data.total).toBe(snapshot.data.sourceCount);
  expect(snapshotSources.data.snapshot).toMatchObject({
    snapshotId: snapshot.data.snapshot.snapshotId,
    snapshotHash: snapshot.data.snapshot.snapshotHash,
  });
  expect(snapshotSources.data.snapshot.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshotSources.data.items.length).toBeGreaterThanOrEqual(1);
  expect(snapshotSources.data.items.every((item) => /^[a-f0-9]{64}$/.test(item.recordHash))).toBe(true);
  await expect(page.getByRole('region', { name: '报告快照来源明细' })).toBeVisible();
  await expect(page.getByText('来源明细（只读）', { exact: true })).toBeVisible();
  const filteredSourcesResponse = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false;
    const url = new URL(response.url());
    return /\/api\/reports\/snapshots\/[^/]+\/sources$/.test(url.pathname)
      && url.searchParams.get('accountingDirection') === 'expense';
  });
  const sourceRegion = page.getByRole('region', { name: '报告快照来源明细' });
  await sourceRegion.getByRole('combobox', { name: '来源方向筛选' }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('支出', { exact: true }).click();
  await sourceRegion.getByRole('button', { name: /查询/ }).click();
  const filteredSources = await readEnvelope<{
    items: Array<{ accountingDirection: string }>;
    total: number;
  }>(await filteredSourcesResponse);
  expect(filteredSources.data.total).toBeGreaterThanOrEqual(1);
  expect(filteredSources.data.items.every((item) => item.accountingDirection === 'expense')).toBe(true);
  await expect(page.getByText('FORMAL_METRIC_POLICY_PENDING', { exact: true })).toBeVisible();

  const narrativeResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/ai/report-snapshots/${snapshot.data.snapshot.snapshotId}/narrative`
  ));
  await page.getByRole('button', { name: '生成 AI 叙述' }).click();
  const narrative = await readEnvelope<{
    status: string;
    narrative: {
      id: string;
      snapshotHash: string;
      narrativeHash: string;
      claims: Array<{ sourcePath: string }>;
      review: { status: string; version: number };
    };
  }>(await narrativeResponse);
  expect(narrative.data.status).toBe('needs_finance_review');
  expect(narrative.data.narrative.snapshotHash).toBe(snapshot.data.snapshot.snapshotHash);
  expect(narrative.data.narrative.claims.some((claim) => claim.sourcePath === '/metrics/recordCount')).toBe(true);
  expect(narrative.data.narrative.review).toMatchObject({ status: 'NEEDS_FINANCE_REVIEW', version: 0 });
  await expect(page.getByText('草稿 · 待财务复核', { exact: true })).toBeVisible();
  await expect(page.getByText('/metrics/recordCount', { exact: true })).toBeVisible();

  await logout(page);
  await login(page, 'finance', '/finance/home');
  const financeQueueResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/ai/report-narratives'
  ));
  await page.goto(`${API_FRONTEND_URL}/finance/reports`);
  const financeQueue = await readEnvelope<{
    items: Array<{ id: string; review: { status: string; version: number } }>;
  }>(await financeQueueResponse);
  expect(financeQueue.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: narrative.data.narrative.id,
      review: expect.objectContaining({ status: 'NEEDS_FINANCE_REVIEW', version: 0 }),
    }),
  ]));
  const financeReviewRegion = page.getByRole('region', {
    name: `报告叙述复核 ${narrative.data.narrative.id}`,
  });
  await expect(financeReviewRegion).toBeVisible();
  await financeReviewRegion.getByLabel(`复核理由-${narrative.data.narrative.id}`)
    .fill(`E2E finance narrative accepted ${suffix}`);
  const financeReviewResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/ai/report-narratives/${narrative.data.narrative.id}/review`
  ));
  await financeReviewRegion.getByRole('button', { name: '财务接受并提交老板' }).click();
  const financeReviewed = await readEnvelope<{
    snapshotHash: string;
    narrativeHash: string;
    review: { status: string; version: number };
  }>(await financeReviewResponse);
  expect(financeReviewed.data).toMatchObject({
    snapshotHash: snapshot.data.snapshot.snapshotHash,
    narrativeHash: narrative.data.narrative.narrativeHash,
    review: { status: 'NEEDS_BOSS_REVIEW', version: 1 },
  });
  await expect(financeReviewRegion.getByText('草稿 · 待老板复核', { exact: true })).toBeVisible();

  await logout(page);
  await login(page, 'boss', '/boss/home');
  const bossQueueResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/ai/report-narratives'
  ));
  await page.goto(`${API_FRONTEND_URL}/boss/reports`);
  const bossQueue = await readEnvelope<{
    items: Array<{ id: string; review: { status: string; version: number } }>;
  }>(await bossQueueResponse);
  expect(bossQueue.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: narrative.data.narrative.id,
      review: expect.objectContaining({ status: 'NEEDS_BOSS_REVIEW', version: 1 }),
    }),
  ]));
  const bossReviewRegion = page.getByRole('region', {
    name: `报告叙述复核 ${narrative.data.narrative.id}`,
  });
  await expect(bossReviewRegion).toBeVisible();
  await bossReviewRegion.getByLabel(`复核理由-${narrative.data.narrative.id}`)
    .fill(`E2E boss narrative accepted ${suffix}`);
  const bossReviewResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/ai/report-narratives/${narrative.data.narrative.id}/review`
  ));
  await bossReviewRegion.getByRole('button', { name: '老板接受文字建议' }).click();
  const bossReviewed = await readEnvelope<{
    snapshotHash: string;
    narrativeHash: string;
    review: { status: string; version: number; history: unknown[] };
  }>(await bossReviewResponse);
  expect(bossReviewed.data).toMatchObject({
    snapshotHash: snapshot.data.snapshot.snapshotHash,
    narrativeHash: narrative.data.narrative.narrativeHash,
    review: { status: 'ACCEPTED', version: 2 },
  });
  expect(bossReviewed.data.review.history).toHaveLength(2);
  await expect(bossReviewRegion.getByText('已接受文字建议', { exact: true })).toBeVisible();

  const recordsAfterNarrativeReview = await readApiEnvelope<{ items: RecordDto[] }>(await page.request.get(
    'http://127.0.0.1:3101/api/records?page=1&pageSize=100',
  ));
  expect(recordsAfterNarrativeReview.data.items.filter((item) => item.id === completed.data.generatedRecordId))
    .toEqual([expect.objectContaining({ amount, sourceId: workOrderId, status: 'confirmed' })]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(
    () => page.locator('.app-sider').evaluate((element) => element.getBoundingClientRect().width),
    { timeout: 5_000 },
  ).toBeLessThanOrEqual(1);
  const mobileWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(mobileWidth.scroll).toBeLessThanOrEqual(mobileWidth.client + 1);
});
