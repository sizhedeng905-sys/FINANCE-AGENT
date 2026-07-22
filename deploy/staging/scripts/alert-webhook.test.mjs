import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AlertWebhookError,
  createSyntheticAlertPair,
  deliverSyntheticAlertPair,
  readWebhookUrl,
  requireSyntheticDeliveryApproval,
} from './alert-webhook.mjs';

test('requires both the one-shot environment approval and confirmation argument', () => {
  for (const [arguments_, environment] of [
    [[], {}],
    [['--confirm-target-alert-delivery'], {}],
    [[], { STAGING_ALERT_SYNTHETIC_DELIVERY_APPROVED: 'true' }],
    [['--confirm-target-alert-delivery'], { STAGING_ALERT_SYNTHETIC_DELIVERY_APPROVED: 'TRUE' }],
  ]) {
    assert.throws(
      () => requireSyntheticDeliveryApproval(arguments_, environment),
      (error) => (
        error instanceof AlertWebhookError
        && error.code === 'ALERT_SYNTHETIC_APPROVAL_REQUIRED'
        && error.status === 'blocked_external'
      ),
    );
  }
  assert.doesNotThrow(() => requireSyntheticDeliveryApproval(
    ['--confirm-target-alert-delivery'],
    { STAGING_ALERT_SYNTHETIC_DELIVERY_APPROVED: 'true' },
  ));
});

test('creates one evidence-linked firing/resolved pair without business data', () => {
  const pair = createSyntheticAlertPair({
    routeId: 'finance-alert-route-cn1',
    generatedAt: new Date('2026-07-22T00:00:00.000Z'),
  });

  assert.equal(pair.firing.status, 'firing');
  assert.equal(pair.resolved.status, 'resolved');
  assert.equal(pair.firing.alerts[0].fingerprint, pair.resolved.alerts[0].fingerprint);
  assert.equal(pair.firing.alerts[0].endsAt, '0001-01-01T00:00:00Z');
  assert.equal(pair.resolved.alerts[0].endsAt, '2026-07-22T00:01:00.000Z');
  assert.equal(JSON.stringify(pair).includes('BusinessRecord'), false);
});

test('delivers firing then recovery to a loopback synthetic receiver', async () => {
  const received = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(join(tmpdir(), 'finance-alert-test-'));
  const port = server.address().port;
  const urlFile = join(directory, 'url');
  await writeFile(urlFile, `http://127.0.0.1:${port}/webhook?synthetic=1\n`, { mode: 0o600 });
  try {
    const result = await deliverSyntheticAlertPair({
      urlFile,
      routeId: 'finance-alert-route-cn1',
      allowHttpLoopback: true,
      generatedAt: new Date('2026-07-22T00:00:00.000Z'),
    });
    assert.equal(result.status, 'passed');
    assert.deepEqual(received.map((payload) => payload.status), ['firing', 'resolved']);
    assert.equal(result.deliveries.every((delivery) => delivery.statusCode === 204), true);
    assert.equal(JSON.stringify(result).includes(`127.0.0.1:${port}`), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('retries bounded transient responses and does not retry a permanent rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-alert-test-'));
  const urlFile = join(directory, 'url');
  await writeFile(urlFile, 'http://127.0.0.1:8080/webhook\n');
  try {
    let calls = 0;
    const retryResult = await deliverSyntheticAlertPair({
      urlFile,
      routeId: 'finance-alert-route-cn1',
      allowHttpLoopback: true,
      sleep: async () => {},
      fetchImplementation: async () => ({
        status: ++calls <= 2 ? 503 : 204,
        body: { cancel: async () => {} },
      }),
    });
    assert.deepEqual(retryResult.deliveries.map((delivery) => delivery.attempts), [3, 1]);
    assert.equal(calls, 4);

    calls = 0;
    await assert.rejects(
      deliverSyntheticAlertPair({
        urlFile,
        routeId: 'finance-alert-route-cn1',
        allowHttpLoopback: true,
        sleep: async () => {},
        fetchImplementation: async () => {
          calls += 1;
          return { status: 400, body: { cancel: async () => {} } };
        },
      }),
      (error) => error instanceof AlertWebhookError && error.code === 'ALERT_WEBHOOK_REJECTED',
    );
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed for missing, non-HTTPS, credentialed, and fragmented target URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-alert-test-'));
  try {
    await expectCode(join(directory, 'missing'), 'ALERT_WEBHOOK_URL_FILE_MISSING');
    for (const [name, value] of [
      ['http', 'http://alerts.corp.internal/webhook'],
      ['credentials', 'https://user:secret@alerts.corp.internal/webhook'],
      ['fragment', 'https://alerts.corp.internal/webhook#secret'],
    ]) {
      const path = join(directory, name);
      await writeFile(path, `${value}\n`);
      await expectCode(path, 'ALERT_WEBHOOK_URL_UNSAFE');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not include webhook URL or provider response text in errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-alert-test-'));
  const urlFile = join(directory, 'url');
  await writeFile(urlFile, 'http://127.0.0.1:8080/private-token\n');
  try {
    await assert.rejects(
      deliverSyntheticAlertPair({
        urlFile,
        routeId: 'finance-alert-route-cn1',
        allowHttpLoopback: true,
        maxAttempts: 1,
        fetchImplementation: async () => { throw new Error('provider-body-private-token'); },
      }),
      (error) => (
        error instanceof AlertWebhookError
        && error.code === 'ALERT_WEBHOOK_DELIVERY_FAILED'
        && !error.message.includes('private-token')
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preserves safe partial evidence when recovery delivery fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-alert-test-'));
  const urlFile = join(directory, 'url');
  await writeFile(urlFile, 'http://127.0.0.1:8080/webhook\n');
  try {
    let calls = 0;
    await assert.rejects(
      deliverSyntheticAlertPair({
        urlFile,
        routeId: 'finance-alert-route-cn1',
        allowHttpLoopback: true,
        maxAttempts: 1,
        fetchImplementation: async () => ({
          status: ++calls === 1 ? 204 : 400,
          body: { cancel: async () => {} },
        }),
      }),
      (error) => (
        error instanceof AlertWebhookError
        && error.code === 'ALERT_WEBHOOK_REJECTED'
        && error.evidence.failedPhase === 'resolved'
        && error.evidence.deliveries.length === 1
        && error.evidence.deliveries[0].phase === 'firing'
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects invalid route, retry, timeout, and transport settings before delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-alert-test-'));
  const urlFile = join(directory, 'url');
  await writeFile(urlFile, 'http://127.0.0.1:8080/webhook\n');
  try {
    for (const [override, code] of [
      [{ routeId: '' }, 'ALERT_SYNTHETIC_ROUTE_ID_INVALID'],
      [{ maxAttempts: 0 }, 'ALERT_WEBHOOK_RETRY_BUDGET_INVALID'],
      [{ timeoutMs: 499 }, 'ALERT_WEBHOOK_TIMEOUT_INVALID'],
      [{ fetchImplementation: null }, 'ALERT_WEBHOOK_TRANSPORT_INVALID'],
      [{ sleep: null }, 'ALERT_WEBHOOK_SLEEP_INVALID'],
    ]) {
      await assert.rejects(
        deliverSyntheticAlertPair({
          urlFile,
          routeId: 'finance-alert-route-cn1',
          allowHttpLoopback: true,
          fetchImplementation: async () => ({ status: 204 }),
          ...override,
        }),
        (error) => error instanceof AlertWebhookError && error.code === code,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects malformed transport responses and tolerates response cleanup failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-alert-test-'));
  const urlFile = join(directory, 'url');
  await writeFile(urlFile, 'http://127.0.0.1:8080/webhook\n');
  try {
    await assert.rejects(
      deliverSyntheticAlertPair({
        urlFile,
        routeId: 'finance-alert-route-cn1',
        allowHttpLoopback: true,
        maxAttempts: 1,
        fetchImplementation: async () => ({ status: 99 }),
      }),
      (error) => error instanceof AlertWebhookError && error.code === 'ALERT_WEBHOOK_RESPONSE_INVALID',
    );

    const result = await deliverSyntheticAlertPair({
      urlFile,
      routeId: 'finance-alert-route-cn1',
      allowHttpLoopback: true,
      fetchImplementation: async () => ({
        status: 204,
        body: { cancel: () => { throw new Error('cleanup failed'); } },
      }),
    });
    assert.equal(result.status, 'passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function expectCode(path, code) {
  await assert.rejects(
    readWebhookUrl(path),
    (error) => error instanceof AlertWebhookError && error.code === code,
  );
}
