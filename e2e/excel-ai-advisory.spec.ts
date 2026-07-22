import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_FRONTEND_URL,
  isApiResponse,
  login,
  logout,
  readEnvelope,
  selectOption,
} from './support/app';

interface ImportColumnDto {
  id: string;
  sourceColumnId?: string;
  sourceName: string;
  columnIndex: number;
}

interface ImportTaskDto {
  id: string;
  templateId: string;
  templateVersion: number;
  status: string;
  columns: ImportColumnDto[];
}

interface AiMappingDto {
  sourceRef: string;
  targetFieldId: string;
  targetFieldName: string;
  targetFieldKey: string;
  transformKey: string;
  confidence: string;
  evidenceRefs: string[];
}

interface AiSuggestionDto {
  status: string;
  mode: string;
  mock: boolean;
  businessRecordsCreated: number;
  classification: {
    aiTaskId: string;
    provider: string;
    model: string;
    promptVersion: string;
    outputHash: string;
    versionVectorHash: string;
    output: {
      selectedTemplateVersionId: string;
      reasonCodes: string[];
      warnings: string[];
    };
  };
  mapping: {
    aiTaskId: string;
    outputHash: string;
    versionVectorHash: string;
    reviewBasis: {
      basisHash: string;
      reviewState: { stateHash: string };
    };
    output: { mappings: AiMappingDto[] };
  };
}

interface AiReviewDecisionDto {
  id: string;
  aiTaskId: string;
  outputHash: string;
  versionVectorHash: string;
  reviewStateHash: string;
  reviewBasisHash: string;
  sourceRef: string;
  decision: 'accept' | 'edit' | 'reject' | 'ignore';
  reviewRevision: number;
  actor: { id: string; username: string; name: string };
}

async function createMappingTask(page: Page) {
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E Stage9 标准费用导入.xlsx');
  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '运输费用模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/import-tasks'));
  const parsedResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/api\/import-tasks\/[^/]+\/parse$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: '上传并解析' }).click();
  const created = await readEnvelope<ImportTaskDto>(await createdResponse);
  const parsed = await readEnvelope<ImportTaskDto>(await parsedResponse);
  expect(parsed.data.id).toBe(created.data.id);
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/mapping$`));
  return parsed.data;
}

async function expectNoOfficialRecords(page: Page, taskId: string) {
  const response = await page.request.get(`http://127.0.0.1:3101/api/records?page=1&pageSize=20&importTaskId=${encodeURIComponent(taskId)}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as {
    code: number;
    message: string;
    data: { items: unknown[]; total: number };
  };
  expect(payload).toMatchObject({ code: 0, message: 'success' });
  expect(payload.data).toMatchObject({ items: [], total: 0 });
}

test('API mode: Excel AI suggestions enter only the finance mapping draft', async ({ page }) => {
  test.setTimeout(120_000);
  const task = await createMappingTask(page);
  let mappingWrites = 0;
  let aiHistoryReads = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PUT'
      && new URL(request.url()).pathname === `/api/import-tasks/${task.id}/mappings`
    ) mappingWrites += 1;
    if (
      request.method() === 'GET'
      && new URL(request.url()).pathname === `/api/import-tasks/${task.id}/ai-suggestions`
    ) aiHistoryReads += 1;
  });

  const aiResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${task.id}/ai-suggestions`,
  ));
  await page.getByRole('button', { name: '获取 AI 映射建议' }).click();
  const suggestion = await readEnvelope<AiSuggestionDto>(await aiResponse);
  expect(suggestion.data).toMatchObject({
    status: 'needs_finance_review',
    mode: 'suggest',
    mock: true,
    businessRecordsCreated: 0,
    classification: {
      provider: 'mock',
      outputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      versionVectorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
    mapping: {
      outputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      versionVectorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reviewBasis: {
        basisHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewState: { stateHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      },
    },
  });
  expect(suggestion.data.mapping.output.mappings.length).toBeGreaterThan(1);

  await expect(page.getByText('AI 映射建议（需人工复核）')).toBeVisible();
  await expect(page.getByText('Mock（仅测试）')).toBeVisible();
  await expect(page.getByText('AI 结果仅进入当前页面草稿，不会自动保存、生成复用规则或入账')).toBeVisible();
  await expect(page.getByText(suggestion.data.classification.aiTaskId)).toBeVisible();
  await expect(page.getByText(suggestion.data.mapping.versionVectorHash)).toBeVisible();
  await expect(page.getByText(suggestion.data.mapping.reviewBasis.basisHash)).toBeVisible();
  await expect(page.getByText('历史 AI 调用 2 条')).toBeVisible();
  expect(aiHistoryReads).toBeGreaterThan(0);

  const first = suggestion.data.mapping.output.mappings[0];
  const second = suggestion.data.mapping.output.mappings[1];
  const firstRow = page.locator('.excel-ai-suggestion-row').filter({ hasText: first.targetFieldName });
  const secondRow = page.locator('.excel-ai-suggestion-row').filter({ hasText: second.targetFieldName });
  await firstRow.getByRole('button', { name: '采纳到草稿' }).click();
  await expect(firstRow.getByText('已采纳到草稿')).toBeVisible();
  await secondRow.getByRole('button', { name: '拒绝建议' }).click();
  await expect(secondRow.getByText('已拒绝')).toBeVisible();
  expect(mappingWrites).toBe(0);
  await expectNoOfficialRecords(page, task.id);

  const firstColumn = task.columns.find((column) => (
    (column.sourceColumnId ?? `column:${column.columnIndex}`) === first.sourceRef
  ));
  expect(firstColumn).toBeDefined();
  const mappingRow = page.locator('.excel-mapping-row').filter({ hasText: firstColumn!.sourceName });
  await mappingRow.locator('.ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '明确忽略此列' }).click();
  await expect(firstRow.getByText('已明确忽略')).toBeVisible();
  expect(mappingWrites).toBe(0);
  await expectNoOfficialRecords(page, task.id);

  await page.goto(`${API_FRONTEND_URL}/data/import-tasks`);
  await page.goto(`${API_FRONTEND_URL}/data/import/${task.id}/mapping`);
  await expect(page.getByText('尚未获取 AI 映射建议，人工映射仍可正常使用')).toBeVisible();
  await expect(page.getByText(suggestion.data.classification.aiTaskId)).toHaveCount(0);

  await logout(page);
  await login(page, '财务', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import/${task.id}/mapping`);
  await expect(page.getByText('尚未获取 AI 映射建议，人工映射仍可正常使用')).toBeVisible();
  await expect(page.getByText(suggestion.data.classification.aiTaskId)).toHaveCount(0);
});

test('API mode: a second finance user sees verified AI review evidence and approval fails closed when it is unavailable', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E AI审核证据费用导入.xlsx');
  await login(page, 'finance', '/finance/home');
  await page.goto(`${API_FRONTEND_URL}/data/import`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '运输费用模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const createdResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/import-tasks'));
  await page.getByRole('button', { name: '上传并解析' }).click();
  const created = await readEnvelope<ImportTaskDto>(await createdResponse);
  await expect(page).toHaveURL(new RegExp(`/data/import/${created.data.id}/mapping$`));
  await page.getByRole('checkbox', { name: '允许使用公式缓存结果' }).check();

  const parsedResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/parse`,
  ));
  await page.getByRole('button', { name: '解析所选区域' }).click();
  const parsed = await readEnvelope<ImportTaskDto>(await parsedResponse);
  expect(parsed.data.status).toBe('pending_confirm');

  const suggestionResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/ai-suggestions`,
  ));
  await page.getByRole('button', { name: '获取 AI 映射建议' }).click();
  const suggestion = await readEnvelope<AiSuggestionDto>(await suggestionResponse);
  expect(suggestion.data).toMatchObject({
    status: 'needs_finance_review',
    mapping: {
      outputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      versionVectorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reviewBasis: { basisHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    },
  });
  expect(suggestion.data.mapping.output.mappings.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '批量采纳到草稿' }).click();
  await expect(page.getByText('已采纳到草稿')).toHaveCount(suggestion.data.mapping.output.mappings.length);

  const saveResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'PUT',
    `/api/import-tasks/${created.data.id}/mappings`,
  ));
  const previewResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'GET',
    `/api/import-tasks/${created.data.id}/preview`,
  ));
  const evidenceResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'GET',
    `/api/import-tasks/${created.data.id}/ai-review-decisions`,
  ));
  await page.getByRole('button', { name: '下一步确认' }).click();
  const saved = await readEnvelope<ImportTaskDto>(await saveResponse);
  expect(saved.data.status).toBe('pending_confirm');
  await readEnvelope(await previewResponse);
  const evidence = await readEnvelope<{
    items: AiReviewDecisionDto[];
    page: number;
    pageSize: number;
    total: number;
  }>(await evidenceResponse);
  expect(evidence.data.total).toBe(suggestion.data.mapping.output.mappings.length);
  expect(evidence.data.items.every((item) => (
    item.aiTaskId === suggestion.data.mapping.aiTaskId
    && item.outputHash === suggestion.data.mapping.outputHash
    && item.versionVectorHash === suggestion.data.mapping.versionVectorHash
    && item.reviewStateHash === suggestion.data.mapping.reviewBasis.reviewState.stateHash
    && item.reviewBasisHash === suggestion.data.mapping.reviewBasis.basisHash
    && item.decision === 'accept'
    && item.actor.username === 'finance'
  ))).toBe(true);
  await expectNoOfficialRecords(page, created.data.id);

  const evidenceCard = page.locator('.ant-card').filter({ hasText: 'AI 映射审核证据' });
  await expect(evidenceCard).toBeVisible();
  await expect(evidenceCard.getByText(`共 ${evidence.data.total} 条`).first()).toBeVisible();
  await expect(evidenceCard.locator('.excel-ai-review-row')).toHaveCount(evidence.data.total);
  await expect(evidenceCard.locator('.excel-ai-review-row').first()).toContainText('采纳');
  await expect(evidenceCard.locator('.excel-ai-review-row').first()).toContainText('finance');
  await evidenceCard.locator('.ant-table-row-expand-icon').first().click();
  const compactOutputHash = `${suggestion.data.mapping.outputHash.slice(0, 12)}...${suggestion.data.mapping.outputHash.slice(-6)}`;
  await expect(evidenceCard.getByText(compactOutputHash)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(evidenceCard).toBeVisible();
  await expect.poll(
    () => page.locator('.app-sider').evaluate((element) => Math.round(element.getBoundingClientRect().width)),
    { message: 'responsive sidebar should finish collapsing before mobile overflow is measured' },
  ).toBeLessThanOrEqual(1);
  const mobileOverflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    compactLayout: window.matchMedia('(max-width: 991px)').matches,
    layout: [
      '.app-shell',
      '.app-sider',
      '.app-sider .ant-layout-sider-children',
      '.app-shell > .ant-layout',
      '.app-content',
      '.excel-ai-review-table',
      '.excel-ai-review-table .ant-table-container',
      '.excel-ai-review-table .ant-table-content',
    ].map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return { selector, missing: true };
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        selector,
        className: element.className,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        minWidth: style.minWidth,
        overflowX: style.overflowX,
      };
    }),
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter(({ left, right }) => left < -1 || right > window.innerWidth + 1)
      .sort((left, right) => right.width - left.width)
      .slice(0, 12),
  }));
  expect(
    mobileOverflow.scrollWidth,
    `mobile horizontal overflow: ${JSON.stringify(mobileOverflow)}`,
  ).toBeLessThanOrEqual(mobileOverflow.innerWidth + 1);
  await page.setViewportSize({ width: 1280, height: 720 });

  await logout(page);
  await login(page, '财务', '/finance/home');
  const secondFinanceEvidenceResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'GET',
    `/api/import-tasks/${created.data.id}/ai-review-decisions`,
  ));
  await page.goto(`${API_FRONTEND_URL}/data/import/${created.data.id}/confirm`);
  await readEnvelope(await secondFinanceEvidenceResponse);
  await expect(page.getByText('上传者不能审批同一导入任务')).toHaveCount(0);

  const revalidateResponse = page.waitForResponse((response) => isApiResponse(
    response,
    'POST',
    `/api/import-tasks/${created.data.id}/revalidate`,
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
    counts: { blockingErrorCount: 0, recordCount: 1 },
  });
  await page.getByRole('checkbox', { name: /已复核当前/ }).check();
  const approveButton = page.getByRole('button', { name: '批准并入库 1 条' });
  await expect(approveButton).toBeEnabled();

  await page.route(`**/api/import-tasks/${created.data.id}/ai-review-decisions*`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 50300, message: '审核证据服务暂时不可用', data: {} }),
    });
  });
  await page.reload();
  await expect(page.getByText('AI 审核证据加载失败，最终批准已暂停')).toBeVisible();
  await page.getByRole('checkbox', { name: /已复核当前/ }).check();
  await expect(approveButton).toBeDisabled();
  await expectNoOfficialRecords(page, created.data.id);
});

test('API mode: cross-template and unavailable AI responses fail closed without erasing manual work', async ({ page }) => {
  test.setTimeout(120_000);
  const task = await createMappingTask(page);
  const unknownRow = page.locator('.excel-mapping-row').filter({ hasText: 'E2E附加费' });
  await unknownRow.locator('.ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '明确忽略此列' }).click();

  const hash = 'a'.repeat(64);
  await page.route(`**/api/import-tasks/${task.id}/ai-suggestions`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          status: 'needs_finance_review',
          mode: 'suggest',
          mock: true,
          businessRecordsCreated: 0,
          aiCalls: 2,
          classification: {
            status: 'succeeded',
            aiTaskId: 'cross-template-classification',
            requestKey: hash,
            reused: false,
            provider: 'mock',
            providerClass: 'mock',
            model: 'mock-structured-v1',
            promptVersion: 'excel_template_classification:v1',
            promptExecutionHash: hash,
            outputSchemaHash: hash,
            outputHash: hash,
            versionVectorHash: hash,
            output: {
              schemaVersion: 'classification/1.0',
              selectedTemplateVersionId: 'foreign-template:v9',
              candidateTemplateVersionIds: ['foreign-template:v9'],
              confidence: '1.0',
              evidenceRefs: ['sheet0:C'],
              reasonCodes: ['CROSS_TEMPLATE_TEST'],
              warnings: [],
              decision: 'NEEDS_FINANCE_REVIEW',
            },
          },
          mapping: {
            status: 'succeeded',
            aiTaskId: 'cross-template-mapping',
            requestKey: hash,
            reused: false,
            provider: 'mock',
            providerClass: 'mock',
            model: 'mock-structured-v1',
            promptVersion: 'excel_column_mapping:v1',
            promptExecutionHash: hash,
            outputSchemaHash: hash,
            outputHash: hash,
            versionVectorHash: hash,
            output: {
              schemaVersion: 'mapping/1.0',
              templateVersionId: 'foreign-template:v9',
              mappings: [{
                sourceRef: task.columns[0].sourceColumnId ?? `column:${task.columns[0].columnIndex}`,
                targetFieldKey: 'foreign_amount',
                targetFieldId: 'foreign-field',
                targetFieldName: '外部模板字段',
                transformKey: 'IDENTITY_V1',
                confidence: '1.0',
                evidenceRefs: [task.columns[0].sourceColumnId ?? `column:${task.columns[0].columnIndex}`],
              }],
              unmappedSourceRefs: [],
              unresolvedRequiredFields: [],
              warnings: [],
              decision: 'NEEDS_FINANCE_REVIEW',
            },
          },
        },
      }),
    });
  });

  await page.getByRole('button', { name: '获取 AI 映射建议' }).click();
  await expect(page.getByText('建议模板与任务冻结模板不一致')).toBeVisible();
  await expect(page.getByRole('button', { name: '批量采纳到草稿' })).toBeDisabled();
  await expect(page.locator('.excel-ai-suggestion-row').getByRole('button', { name: /采纳到草稿/ })).toBeDisabled();
  await expect(unknownRow.locator('.ant-select-selection-item')).toHaveText('明确忽略此列');

  await page.unroute(`**/api/import-tasks/${task.id}/ai-suggestions`);
  await page.route(`**/api/import-tasks/${task.id}/ai-suggestions`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 50300, message: 'AI Provider 暂时不可用', data: {} }),
    });
  });
  await page.getByRole('button', { name: '重新获取 AI 建议' }).click();
  await expect(page.getByText('AI 建议不可用，当前人工映射草稿未改变')).toBeVisible();
  await expect(unknownRow.locator('.ant-select-selection-item')).toHaveText('明确忽略此列');
  await expectNoOfficialRecords(page, task.id);
});
