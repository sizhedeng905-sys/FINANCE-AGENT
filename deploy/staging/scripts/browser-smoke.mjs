import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...parseEnvironmentSource(await readFile(join(stagingRoot, '.env'), 'utf8'), 'staging environment'),
  ...process.env,
};
const settings = resolveDeploymentEnvironment(env);
const password = (await readFile(join(stagingRoot, '.secrets', 'staging_seed_password'), 'utf8')).trim();
const baseUrl = settings.appBaseUrl;
const browserChannel = process.env.STAGING_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
  args: [
    '--no-proxy-server',
    `--host-resolver-rules=MAP ${settings.appDomain} ${settings.gatewayProbeAddress}`,
  ],
});

let projectId;
let applicationPage;
try {
  await assertBackendFailureDoesNotUseMock();

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    window.__financeAgentCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__financeAgentCspViolations.push({
        blockedUri: event.blockedURI,
        directive: event.effectiveDirective,
      });
    });
  });
  const page = await context.newPage();
  applicationPage = page;
  const pageErrors = [];
  const consoleErrors = [];
  const apiResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/')) apiResponses.push({ status: response.status(), url: response.url() });
  });

  const navigation = await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  assert(navigation?.status() === 200, 'SPA navigation did not return 200');
  assertSecurityHeaders(navigation.headers());

  const runtimeResponse = await page.evaluate(async () => {
    const response = await fetch('/runtime-config.json', { credentials: 'same-origin' });
    return { status: response.status, body: await response.json() };
  });
  assert(runtimeResponse.status === 200, 'runtime build manifest is unavailable');
  assert(runtimeResponse.body.dataMode === 'api', 'dataMode === \'api\' was not built into the staging image');
  assert(runtimeResponse.body.apiBaseUrl === '/api', 'staging API base is not /api');

  const rootText = await page.locator('#root').innerText();
  assert(rootText.trim().length > 0, 'React root is blank');
  assert(rootText.includes('API'), 'rendered application does not report API mode');
  assert(!rootText.includes('演示环境测试账号'), 'staging application exposed Mock demo controls');
  assert(pageErrors.length === 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
  const expectedAnonymousProbe = apiResponses.some(
    (response) => response.url.includes('/api/auth/me') && response.status === 401,
  );
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !(expectedAnonymousProbe && message.includes('401 (Unauthorized)')),
  );
  assert(unexpectedConsoleErrors.length === 0, `unexpected console errors: ${unexpectedConsoleErrors.join(' | ')}`);
  assert((await page.evaluate(() => window.__financeAgentCspViolations)).length === 0, 'normal application load violated CSP');

  const loginResponse = page.waitForResponse(
    (response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.getByLabel('登录账号').fill('uat-finance');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入系统' }).click();
  assert((await loginResponse).status() === 200, 'browser login did not reach the backend');
  await page.waitForURL((url) => url.pathname !== '/login');

  const marker = `staging-browser-smoke-${Date.now()}`;
  const created = await browserApi(page, '/api/projects', {
    method: 'POST',
    body: {
      name: marker,
      customerName: 'synthetic-smoke-customer',
      ownerName: 'synthetic-smoke-owner',
      description: 'R1 browser smoke synthetic record',
    },
  });
  assert(created.status === 201 && created.body?.data?.id, 'synthetic project write failed');
  projectId = created.body.data.id;

  const persisted = await browserApi(page, `/api/projects/${encodeURIComponent(projectId)}`);
  assert(persisted.status === 200 && persisted.body?.data?.name === marker, 'backend read did not prove the browser write');

  const removed = await browserApi(page, `/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  assert(removed.status === 200 && removed.body?.data?.status === 'archived', 'synthetic project cleanup failed');
  projectId = undefined;

  assert(apiResponses.some((response) => response.url.includes('/api/auth/login') && response.status === 200), 'no real API login response was observed');
  assert(apiResponses.some((response) => response.url.includes('/api/projects') && response.status === 201), 'no real API write response was observed');

  const cspAttack = await page.evaluate(async () => {
    window.__financeAgentInlineExecuted = false;
    const script = document.createElement('script');
    script.textContent = 'window.__financeAgentInlineExecuted = true';
    document.body.appendChild(script);

    let externalConnectBlocked = false;
    try {
      await fetch('https://blocked.invalid/csp-probe');
    } catch {
      externalConnectBlocked = true;
    }
    const frame = document.createElement('iframe');
    frame.src = 'https://blocked.invalid/frame-probe';
    document.body.appendChild(frame);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    return {
      externalConnectBlocked,
      inlineExecuted: window.__financeAgentInlineExecuted,
      violations: window.__financeAgentCspViolations,
    };
  });
  assert(!cspAttack.inlineExecuted, 'CSP allowed an inline script');
  assert(cspAttack.externalConnectBlocked, 'CSP allowed an unapproved external connection');
  assert(cspAttack.violations.some((item) => item.directive.startsWith('script-src')), 'inline script CSP violation was not observed');
  assert(cspAttack.violations.some((item) => item.directive === 'connect-src'), 'connect-src CSP violation was not observed');
  assert(cspAttack.violations.some((item) => item.directive === 'frame-src'), 'external frame CSP violation was not observed');

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    endpoint: baseUrl,
    dataMode: runtimeResponse.body.dataMode,
    apiResponseCount: apiResponses.length,
    cspDirectivesProbed: ['script-src', 'connect-src', 'frame-src'],
    syntheticWriteSoftArchived: true,
  }, null, 2)}\n`);
  await context.close();
} finally {
  if (projectId && applicationPage) {
    try {
      const cleanup = await browserApi(applicationPage, `/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      if (cleanup.status === 200 && cleanup.body?.data?.status === 'archived') {
        process.stderr.write(`Soft-archived synthetic project ${projectId} after an interrupted smoke run.\n`);
        projectId = undefined;
      }
    } catch (error) {
      process.stderr.write(`Synthetic project cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  if (projectId) {
    process.stderr.write(`Synthetic project ${projectId} requires manual soft archival after an interrupted smoke run.\n`);
  }
  await browser.close();
}

async function assertBackendFailureDoesNotUseMock() {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route('**/api/auth/login', (route) => route.abort('failed'));
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('登录账号').fill('uat-finance');
  await page.getByLabel('密码').fill('synthetic-unavailable-probe');
  await page.getByRole('button', { name: '进入系统' }).click();
  await page.getByText('登录失败', { exact: true }).first().waitFor();
  assert((await page.getByText('演示环境测试账号', { exact: true }).count()) === 0, 'backend failure exposed Mock login controls');
  await context.close();
}

async function browserApi(page, path, options = {}) {
  return page.evaluate(async ({ requestPath, requestOptions }) => {
    const csrfCookie = document.cookie
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('__Host-finance_agent_csrf=') || value.startsWith('finance_agent_csrf='));
    const csrfToken = csrfCookie ? decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf('=') + 1)) : undefined;
    const response = await fetch(requestPath, {
      method: requestOptions.method ?? 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }, { requestPath: path, requestOptions: options });
}

function assertSecurityHeaders(headers) {
  const csp = headers['content-security-policy'] ?? '';
  for (const directive of ['default-src', 'script-src', 'connect-src', 'img-src', 'object-src', 'base-uri', 'frame-ancestors']) {
    assert(csp.includes(directive), `CSP is missing ${directive}`);
  }
  assert(!csp.includes('*'), 'CSP contains a wildcard source');
  assert(!/script-src[^;]*'unsafe-(?:inline|eval)'/.test(csp), 'script-src contains an unsafe source');
  assert(headerValues(headers, 'x-content-type-options').every((value) => value === 'nosniff'), 'X-Content-Type-Options is missing or invalid');
  assert(headerValues(headers, 'x-frame-options').every((value) => value === 'deny'), 'X-Frame-Options is missing or invalid');
}

function headerValues(headers, name) {
  const value = headers[name] ?? '';
  const values = value.split(/[\r\n,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  assert(values.length > 0, `${name} is missing`);
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Staging browser smoke failed: ${message}`);
}
