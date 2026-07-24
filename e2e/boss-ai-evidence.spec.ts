import { expect, test } from '@playwright/test';
import type { AIChatResponse } from '../src/types/ai';
import {
  API_FRONTEND_URL,
  isApiResponse,
  login,
  readEnvelope
} from './support/app';

test('API mode: boss AI exposes auditable model and claim evidence', async ({ page }) => {
  await login(page, 'boss', '/boss/home');
  await page.goto(`${API_FRONTEND_URL}/boss/ai`);

  const chatResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/ai/chat'));
  await page.getByRole('button', { name: '今天经营情况怎么样？' }).click();
  const chat = await readEnvelope<AIChatResponse>(await chatResponse);

  expect(chat.data.fallback).toBe(false);
  expect(chat.data.callLogId).toBeTruthy();
  expect(chat.data.provider).toBeTruthy();
  expect(chat.data.model).toBeTruthy();

  const evidence = page.locator('details.chat-evidence').last();
  await expect(evidence).toBeVisible();
  await evidence.locator('summary').click();
  await expect(evidence.getByText(chat.data.callLogId, { exact: true })).toBeVisible();
  await expect(evidence.getByText(new RegExp(chat.data.model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();

  const firstClaim = chat.data.claims?.[0];
  if (firstClaim) {
    await expect(evidence.getByText(firstClaim.sourcePath, { exact: false })).toBeVisible();
    await expect(
      evidence.getByText(`${firstClaim.scopeType}:${firstClaim.scopeId}`, { exact: true }).first()
    ).toBeVisible();
  } else {
    await expect(evidence.getByText(/没有声明财务汇总 Claim/)).toBeVisible();
  }

  const pendingResponse = page.waitForResponse((response) => isApiResponse(response, 'POST', '/api/ai/chat'));
  await page.getByRole('button', { name: '有哪些待老板审批工单？' }).click();
  const pending = await readEnvelope<AIChatResponse>(await pendingResponse);
  expect(pending.data.fallback).toBe(false);
  expect(pending.data.claims ?? []).toHaveLength(0);

  const pendingEvidence = page.locator('details.chat-evidence').last();
  await pendingEvidence.locator('summary').click();
  await expect(pendingEvidence.getByText(pending.data.callLogId, { exact: true })).toBeVisible();
  await expect(pendingEvidence.getByText(/没有声明财务汇总 Claim/)).toBeVisible();
});
