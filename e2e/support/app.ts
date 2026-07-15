import { expect, type Page, type Response } from '@playwright/test';

export const API_FRONTEND_URL = 'http://127.0.0.1:4173';
export const MOCK_FRONTEND_URL = 'http://127.0.0.1:4174';

export interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export async function login(page: Page, username: string, expectedPath: string, baseUrl = API_FRONTEND_URL) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('登录账号').fill(username);
  await page.getByLabel('密码').fill('123456');
  await page.getByRole('button', { name: '进入系统' }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replaceAll('/', '\\/')}$`));
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /退出/ }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export function chinaDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function selectOption(page: Page, label: string, option: string) {
  await page.getByLabel(label).click();
  await page.locator('.ant-select-item-option').filter({ hasText: option }).click();
}

export async function completeApprovalModal(page: Page, title: string, comment: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill(comment);
  await dialog.getByRole('button', { name: /确\s*认/ }).click();
  await expect(dialog).toBeHidden();
}

export async function readEnvelope<T>(response: Response): Promise<Envelope<T>> {
  expect(response.ok(), `${response.request().method()} ${response.url()} should succeed`).toBeTruthy();
  const body = await response.json() as Envelope<T>;
  expect(body.code, `${response.url()} should return code=0`).toBe(0);
  expect(body.message).toBe('success');
  return body;
}

export function isApiResponse(response: Response, method: string, pathname: string) {
  const url = new URL(response.url());
  return response.request().method() === method && url.pathname === pathname;
}
