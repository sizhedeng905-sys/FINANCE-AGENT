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
    output: { mappings: AiMappingDto[] };
  };
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
    },
  });
  expect(suggestion.data.mapping.output.mappings.length).toBeGreaterThan(1);

  await expect(page.getByText('AI 映射建议（需人工复核）')).toBeVisible();
  await expect(page.getByText('Mock（仅测试）')).toBeVisible();
  await expect(page.getByText('AI 结果仅进入当前页面草稿，不会自动保存、生成复用规则或入账')).toBeVisible();
  await expect(page.getByText(suggestion.data.classification.aiTaskId)).toBeVisible();
  await expect(page.getByText(suggestion.data.mapping.versionVectorHash)).toBeVisible();
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
