import { resolve } from 'node:path';
import { expect, test, type APIResponse } from '@playwright/test';

import { login, readEnvelope, selectOption } from './support/app';

const FRONTEND_URL = 'http://127.0.0.1:4175';
const API_URL = 'http://127.0.0.1:3102/api';

interface OcrField {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  isRequired: boolean;
  missing: boolean;
  lowConfidence: boolean;
  validationError?: string;
}

interface OcrTask {
  id: string;
  status: string;
  fields: OcrField[];
  attempts: Array<{
    status: string;
    provider: string;
    endpointSnapshot?: string;
    providerConfigHash?: string;
  }>;
}

async function readApiEnvelope<T>(response: APIResponse) {
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { code: number; message: string; data: T };
  expect(body).toMatchObject({ code: 0, message: 'success' });
  return body;
}

test('real Paddle provider completes queued UI flow without automatic posting', async ({ page, request }) => {
  const fixture = resolve(import.meta.dirname, '../backend/test-uploads/e2e-fixtures/E2E OCR 标准票据.pdf');
  await login(page, 'finance', '/finance/home', FRONTEND_URL);
  const apiLogin = await readApiEnvelope<{ accessToken: string }>(await request.post(`${API_URL}/auth/login`, {
    data: { username: 'finance', password: '123456' }
  }));
  const token = apiLogin.data.accessToken;
  const headers = { Authorization: `Bearer ${token}` };
  const recordsBefore = await readApiEnvelope<{ total: number }>(await request.get(`${API_URL}/records?page=1&pageSize=1`, { headers }));

  await page.goto(`${FRONTEND_URL}/data/ocr`);
  await selectOption(page, '项目', '太和中转项目');
  await selectOption(page, '模板', '报销工单模板');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  const runResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && /\/api\/ocr-tasks\/[^/]+\/run$/.test(new URL(response.url()).pathname)
  ));
  await page.getByRole('button', { name: '上传并识别' }).click();
  const queued = await readEnvelope<OcrTask>(await runResponse);
  expect(queued.data.status).toBe('queued');
  await expect(page).toHaveURL(new RegExp(`/data/ocr/${queued.data.id}$`));

  let task!: OcrTask;
  await expect.poll(async () => {
    const response = await request.get(`${API_URL}/ocr-tasks/${queued.data.id}`, { headers });
    task = (await readApiEnvelope<OcrTask>(response)).data;
    return task.status;
  }, { timeout: 720_000, intervals: [1000, 2000, 5000] }).toBe('pending_confirm');

  expect(task.attempts[0]).toMatchObject({
    status: 'succeeded',
    provider: 'local_paddle',
    endpointSnapshot: expect.stringContaining('8868'),
    providerConfigHash: expect.stringMatching(/^[a-f0-9]{64}$/)
  });
  const recordsWhilePending = await readApiEnvelope<{ total: number }>(
    await request.get(`${API_URL}/records?page=1&pageSize=1`, { headers })
  );
  expect(recordsWhilePending.data.total).toBe(recordsBefore.data.total);
  const corrections = task.fields
    .filter((field) => field.isRequired && field.fieldType !== 'file' && (
      field.missing || field.lowConfidence || Boolean(field.validationError)
    ))
    .map((field) => ({
      fieldId: field.fieldId,
      correctedValue: field.fieldType === 'date'
        ? '2026-07-15'
        : ['number', 'money'].includes(field.fieldType)
          ? '1366.66'
          : field.fieldType === 'select'
            ? '其他'
            : 'E2E 真实 OCR 人工核对',
      reason: 'B8-04 真实 Provider E2E 人工修正'
    }));
  if (corrections.length) {
    const correction = await request.put(`${API_URL}/ocr-tasks/${task.id}/corrections`, {
      headers,
      data: { corrections }
    });
    expect(correction.ok()).toBeTruthy();
  }

  await page.reload();
  await expect(page.getByRole('button', { name: '确认并生成经营记录' })).toBeVisible({ timeout: 30_000 });
  const acknowledge = page.getByRole('checkbox');
  if (await acknowledge.count()) await acknowledge.check();
  const confirmResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/ocr-tasks/${task.id}/confirm`
  ));
  await page.getByRole('button', { name: '确认并生成经营记录' }).click();
  const confirmed = await readEnvelope<{ record: { id: string; sourceId: string; status: string } }>(await confirmResponse);
  expect(confirmed.data.record).toMatchObject({ sourceId: task.id, status: 'confirmed' });

  const recordsAfter = await readApiEnvelope<{ total: number }>(await request.get(`${API_URL}/records?page=1&pageSize=1`, { headers }));
  expect(recordsAfter.data.total - recordsBefore.data.total).toBe(1);
});
