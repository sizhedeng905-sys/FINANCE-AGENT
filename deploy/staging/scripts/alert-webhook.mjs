import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

export const ALERT_SYNTHETIC_SCHEMA = 'staging-alert-synthetic/1.0';

export class AlertWebhookError extends Error {
  constructor(code, status = 'failed', evidence = {}) {
    super(code);
    this.name = 'AlertWebhookError';
    this.code = code;
    this.status = status;
    this.evidence = Object.freeze({ ...evidence });
  }
}

export function requireSyntheticDeliveryApproval(arguments_, environment) {
  if (
    !Array.isArray(arguments_)
    || !arguments_.includes('--confirm-target-alert-delivery')
    || environment?.STAGING_ALERT_SYNTHETIC_DELIVERY_APPROVED !== 'true'
  ) {
    throw new AlertWebhookError('ALERT_SYNTHETIC_APPROVAL_REQUIRED', 'blocked_external');
  }
}

export function createSyntheticAlertPair({ routeId, generatedAt = new Date() }) {
  validateRouteId(routeId);
  if (!(generatedAt instanceof Date) || !Number.isFinite(generatedAt.getTime())) {
    throw new AlertWebhookError('ALERT_SYNTHETIC_TIME_INVALID');
  }
  const routeHash = sha256(routeId).slice(0, 16);
  const fingerprint = sha256(`finance-agent-synthetic-alert:${routeHash}`).slice(0, 16);
  const startsAt = generatedAt.toISOString();
  const resolvedAt = new Date(generatedAt.getTime() + 60_000).toISOString();
  const common = {
    version: '4',
    groupKey: `{}/{}:{alertname="FinanceAgentSyntheticDelivery",route="${routeHash}"}`,
    truncatedAlerts: 0,
    receiver: 'target-webhook',
    groupLabels: { alertname: 'FinanceAgentSyntheticDelivery' },
    commonLabels: { alertname: 'FinanceAgentSyntheticDelivery', severity: 'warning', synthetic: 'true' },
    commonAnnotations: { summary: 'FINANCE-AGENT synthetic alert delivery test' },
    externalURL: '',
  };
  const alert = (status, endsAt) => ({
    status,
    labels: common.commonLabels,
    annotations: common.commonAnnotations,
    startsAt,
    endsAt,
    generatorURL: '',
    fingerprint,
  });
  return Object.freeze({
    firing: { ...common, status: 'firing', alerts: [alert('firing', '0001-01-01T00:00:00Z')] },
    resolved: { ...common, status: 'resolved', alerts: [alert('resolved', resolvedAt)] },
  });
}

export async function deliverSyntheticAlertPair({
  urlFile,
  routeId,
  fetchImplementation = fetch,
  allowHttpLoopback = false,
  maxAttempts = 3,
  timeoutMs = 5_000,
  sleep = defaultSleep,
  generatedAt = new Date(),
}) {
  validateDeliveryOptions({ fetchImplementation, maxAttempts, timeoutMs, sleep });
  const url = await readWebhookUrl(urlFile, { allowHttpLoopback });
  const pair = createSyntheticAlertPair({ routeId, generatedAt });
  const deliveries = [];
  for (const phase of ['firing', 'resolved']) {
    const payload = pair[phase];
    let result;
    try {
      result = await deliver({
        url,
        payload,
        fetchImplementation,
        maxAttempts,
        timeoutMs,
        sleep,
      });
    } catch (error) {
      throw new AlertWebhookError(
        error instanceof AlertWebhookError ? error.code : 'ALERT_WEBHOOK_DELIVERY_FAILED',
        error instanceof AlertWebhookError ? error.status : 'failed',
        { failedPhase: phase, deliveries },
      );
    }
    deliveries.push({
      phase,
      statusCode: result.statusCode,
      attempts: result.attempts,
      payloadSha256: sha256(JSON.stringify(payload)),
    });
  }
  return Object.freeze({
    schemaVersion: ALERT_SYNTHETIC_SCHEMA,
    status: 'passed',
    routeIdSha256: sha256(routeId),
    endpointOriginSha256: sha256(url.origin),
    deliveries,
  });
}

export async function readWebhookUrl(path, { allowHttpLoopback = false } = {}) {
  let source;
  try {
    source = (await readFile(path, 'utf8')).trim();
  } catch {
    throw new AlertWebhookError('ALERT_WEBHOOK_URL_FILE_MISSING', 'blocked_external');
  }
  if (!source) throw new AlertWebhookError('ALERT_WEBHOOK_URL_FILE_EMPTY', 'blocked_external');
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new AlertWebhookError('ALERT_WEBHOOK_URL_INVALID', 'blocked_external');
  }
  const loopback = isLoopback(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !(allowHttpLoopback && parsed.protocol === 'http:' && loopback))
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new AlertWebhookError('ALERT_WEBHOOK_URL_UNSAFE', 'blocked_external');
  }
  return parsed;
}

async function deliver({ url, payload, fetchImplementation, maxAttempts, timeoutMs, sleep }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImplementation(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'finance-agent-alert-synthetic/1.0',
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (attempt === maxAttempts) throw new AlertWebhookError('ALERT_WEBHOOK_DELIVERY_FAILED');
      await sleep(attempt * 100);
      continue;
    }
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new AlertWebhookError('ALERT_WEBHOOK_RESPONSE_INVALID');
    }
    cancelResponseBody(response.body);
    if (response.status >= 200 && response.status < 300) {
      return { statusCode: response.status, attempts: attempt };
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
      throw new AlertWebhookError(
        [429, 500, 502, 503, 504].includes(response.status)
          ? 'ALERT_WEBHOOK_RETRY_EXHAUSTED'
          : 'ALERT_WEBHOOK_REJECTED',
      );
    }
    await sleep(attempt * 100);
  }
  throw new AlertWebhookError('ALERT_WEBHOOK_DELIVERY_FAILED');
}

function validateDeliveryOptions({ fetchImplementation, maxAttempts, timeoutMs, sleep }) {
  if (typeof fetchImplementation !== 'function') {
    throw new AlertWebhookError('ALERT_WEBHOOK_TRANSPORT_INVALID');
  }
  if (typeof sleep !== 'function') {
    throw new AlertWebhookError('ALERT_WEBHOOK_SLEEP_INVALID');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new AlertWebhookError('ALERT_WEBHOOK_RETRY_BUDGET_INVALID');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
    throw new AlertWebhookError('ALERT_WEBHOOK_TIMEOUT_INVALID');
  }
}

function cancelResponseBody(body) {
  try {
    const result = body?.cancel?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Response cleanup must not replace the bounded delivery result.
  }
}

function validateRouteId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/.test(String(value ?? ''))) {
    throw new AlertWebhookError('ALERT_SYNTHETIC_ROUTE_ID_INVALID');
  }
}

function isLoopback(hostname) {
  if (hostname === 'localhost') return true;
  if (isIP(hostname) === 4) return hostname.startsWith('127.');
  return hostname === '[::1]' || hostname === '::1';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
