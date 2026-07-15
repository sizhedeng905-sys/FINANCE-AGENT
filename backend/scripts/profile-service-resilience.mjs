import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { dirname, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';

const backendRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(backendRoot, '..');
const privateRoot = resolve(repositoryRoot, '.realdata-test');
const envFile = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');
const outputPath = resolve(repositoryRoot, readArgument('--output') || '.realdata-test/reports/service-resilience.local.json');

if (existsSync(envFile)) loadEnvFile(envFile);
assertPrivateOutput(outputPath);

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required.');
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ''));
if (!databaseName.endsWith('_test')) {
  throw new Error(`Resilience profile refuses to use non-test database "${databaseName}".`);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedDatabaseUrl.hostname)) {
  throw new Error('Resilience profile only supports a local PostgreSQL test database.');
}

const targetPort = Number(parsedDatabaseUrl.port || 5432);
const proxyPort = await freePort();
const backendPort = await freePort();
const proxiedDatabaseUrl = new URL(parsedDatabaseUrl);
proxiedDatabaseUrl.hostname = '127.0.0.1';
proxiedDatabaseUrl.port = String(proxyPort);

const report = {
  generatedAt: new Date().toISOString(),
  databaseClass: 'local_postgresql_test',
  backendRestart: {},
  databaseOutage: {},
  assertions: {
    livenessSurvivedDatabaseOutage: false,
    readinessFailedClosed: false,
    readinessRecovered: false,
    unifiedErrorEnvelope: false,
    unexpectedHttp500: 0
  },
  passed: false
};

let proxy;
let backend;
const observedStatuses = [];

try {
  proxy = await startProxy(proxyPort, parsedDatabaseUrl.hostname, targetPort);
  backend = startBackend(backendPort, proxiedDatabaseUrl.toString());
  await waitForStatus('/api/health/live', 200, 30_000);
  await waitForStatus('/api/health/ready', 200, 30_000);

  const restartStartedAt = performance.now();
  await stopBackend(backend);
  backend = startBackend(backendPort, proxiedDatabaseUrl.toString());
  await waitForStatus('/api/health/live', 200, 30_000);
  await waitForStatus('/api/health/ready', 200, 30_000);
  report.backendRestart = {
    recovered: true,
    recoveryMs: round(performance.now() - restartStartedAt)
  };

  const outageStartedAt = performance.now();
  await proxy.close();
  proxy = undefined;
  const failedReady = await waitForStatus('/api/health/ready', 503, 30_000);
  const liveDuringOutage = await probe('/api/health/live');
  report.assertions.readinessFailedClosed = failedReady.status === 503;
  report.assertions.livenessSurvivedDatabaseOutage = liveDuringOutage.status === 200;
  report.assertions.unifiedErrorEnvelope = isEnvelope(failedReady.body, false);

  const recoveryStartedAt = performance.now();
  proxy = await startProxy(proxyPort, parsedDatabaseUrl.hostname, targetPort);
  const recoveredReady = await waitForStatus('/api/health/ready', 200, 30_000);
  report.assertions.readinessRecovered = recoveredReady.status === 200 && isEnvelope(recoveredReady.body, true);
  report.databaseOutage = {
    detected: true,
    detectionMs: round(recoveryStartedAt - outageStartedAt),
    recovered: true,
    recoveryMs: round(performance.now() - recoveryStartedAt)
  };

  report.assertions.unexpectedHttp500 = observedStatuses.filter((status) => status === 500).length;
  report.passed = Object.entries(report.assertions).every(([key, value]) =>
    key === 'unexpectedHttp500' ? value === 0 : value === true
  );
  if (!report.passed) throw new Error('One or more resilience assertions failed.');
} finally {
  if (backend) await stopBackend(backend).catch(() => undefined);
  if (proxy) await proxy.close().catch(() => undefined);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  passed: report.passed,
  backendRestart: report.backendRestart,
  databaseOutage: report.databaseOutage,
  assertions: report.assertions,
  output: outputPath
}, null, 2));

function startBackend(port, connectionUrl) {
  const child = spawn(process.execPath, ['--require', 'ts-node/register/transpile-only', 'src/main.ts'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: connectionUrl,
      TEST_DATABASE_URL: connectionUrl,
      SWAGGER_ENABLED: 'false',
      REQUEST_RATE_LIMIT_MAX: '5000'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const diagnostics = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => {
      diagnostics.push(chunk.toString('utf8'));
      if (diagnostics.length > 20) diagnostics.shift();
    });
  }
  child.diagnostics = diagnostics;
  return child;
}

async function stopBackend(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const result = await Promise.race([
    exited.then(() => true),
    delay(10_000).then(() => false)
  ]);
  if (!result) throw new Error('Backend did not stop within 10 seconds.');
}

async function startProxy(port, targetHost, targetDatabasePort) {
  const sockets = new Set();
  const server = createServer((client) => {
    const upstream = connect({ host: targetHost, port: targetDatabasePort });
    sockets.add(client);
    sockets.add(upstream);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    client.pipe(upstream).pipe(client);
    const closePair = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', closePair);
    upstream.on('error', closePair);
    client.on('close', () => sockets.delete(client));
    upstream.on('close', () => sockets.delete(upstream));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        for (const socket of sockets) socket.destroy();
      });
    }
  };
}

async function waitForStatus(path, expectedStatus, timeoutMs) {
  const startedAt = performance.now();
  let last;
  while (performance.now() - startedAt < timeoutMs) {
    last = await probe(path);
    if (last.status === expectedStatus) return last;
    if (backend?.exitCode !== null) {
      throw new Error(`Backend exited before ${path} returned ${expectedStatus}: ${backend.diagnostics.join('').slice(-2000)}`);
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${path} to return ${expectedStatus}; last status was ${last?.status ?? 'network_error'}.`);
}

async function probe(path) {
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}${path}`, {
      signal: AbortSignal.timeout(2_000)
    });
    observedStatuses.push(response.status);
    return { status: response.status, body: await response.json().catch(() => undefined) };
  } catch {
    return { status: undefined, body: undefined };
  }
}

function isEnvelope(value, success) {
  if (!value || typeof value !== 'object' || typeof value.code !== 'number') return false;
  if (typeof value.message !== 'string' || !value.data || typeof value.data !== 'object') return false;
  return success ? value.code === 0 : value.code !== 0;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to reserve a TCP port.');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function assertPrivateOutput(path) {
  if (path !== privateRoot && !path.startsWith(`${privateRoot}${sep}`)) {
    throw new Error('Resilience output must stay under .realdata-test/.');
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
