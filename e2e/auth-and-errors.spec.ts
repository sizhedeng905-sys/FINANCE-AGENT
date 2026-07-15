import { expect, test } from '@playwright/test';
import { API_FRONTEND_URL, login, MOCK_FRONTEND_URL } from './support/app';

const roles = [
  { username: 'employee', path: '/employee/home', heading: '员工首页' },
  { username: 'finance', path: '/finance/home', heading: '财务首页' },
  { username: 'reviewer', path: '/reviewer/home', heading: '复核员首页' },
  { username: 'boss', path: '/boss/home', heading: '老板首页' }
] as const;

for (const role of roles) {
  test(`API mode: ${role.username} logs in to the role default page`, async ({ page }) => {
    await login(page, role.username, role.path);
    await expect(page.getByRole('heading', { name: role.heading })).toBeVisible();
    await expect(page.getByText('API', { exact: true })).toHaveCount(0);
  });
}

test('API mode: a 401 response clears the session and returns to login', async ({ page }) => {
  await login(page, 'employee', '/employee/home');
  await page.route('**/api/work-orders?**', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: { 'X-Request-Id': 'e2e-expired-session' },
      body: JSON.stringify({ code: 401, message: '登录状态已失效', data: {} })
    });
  });

  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  await expect(page.evaluate(() => localStorage.getItem('finance-agent-access-token-v1'))).resolves.toBeNull();
});

test('API mode: network failures expose a retryable request-id error', async ({ page }) => {
  await login(page, 'employee', '/employee/home');
  await page.route('**/api/projects?**', (route) => route.abort('failed'));
  await page.goto(`${API_FRONTEND_URL}/work-orders/create`);

  const alert = page.getByRole('alert').filter({ hasText: '可用项目加载失败' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('无法连接后端服务');
  await expect(alert).toContainText('请求编号');
});

test('client authorization renders a clear 403 page for an employee', async ({ page }) => {
  await login(page, 'employee', '/employee/home');
  await page.goto(`${API_FRONTEND_URL}/data/projects`);
  await expect(page.getByText('403', { exact: true })).toBeVisible();
  await expect(page.getByText('当前账号没有访问该页面的权限。')).toBeVisible();
});

test('Mock mode is explicit and performs no backend request', async ({ page }) => {
  let backendRequests = 0;
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:3101/api')) backendRequests += 1;
  });

  await page.goto(`${MOCK_FRONTEND_URL}/login`);
  await expect(page.getByText('Mock', { exact: true })).toBeVisible();
  await login(page, 'employee', '/employee/home', MOCK_FRONTEND_URL);
  await page.goto(`${MOCK_FRONTEND_URL}/work-orders/create`);
  await expect(page.getByRole('heading', { name: '新建工单' })).toBeVisible();
  expect(backendRequests).toBe(0);
});

test('API runtime exposes security headers, CORS allowlist, and database readiness', async ({ request }) => {
  const ready = await request.get('http://127.0.0.1:3101/api/health/ready', {
    headers: { Origin: API_FRONTEND_URL }
  });
  expect(ready.ok()).toBeTruthy();
  expect(ready.headers()['access-control-allow-origin']).toBe(API_FRONTEND_URL);
  expect(ready.headers()['x-content-type-options']).toBe('nosniff');
  expect(ready.headers()['x-frame-options']).toBe('DENY');
  expect(ready.headers()['content-security-policy']).toContain("default-src 'self'");
  expect((await ready.json()).data).toMatchObject({ status: 'ok', database: 'ok' });

  const disallowed = await request.get('http://127.0.0.1:3101/api/health', {
    headers: { Origin: 'https://untrusted.invalid' }
  });
  expect(disallowed.ok()).toBeTruthy();
  expect(disallowed.headers()['access-control-allow-origin']).toBeUndefined();
});
