import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MiB = 1024 * 1024;
const applicationLimit = 50 * MiB;
const nginxImage = 'nginx@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const sourcePath = path.join(repositoryRoot, 'deploy', 'nginx.conf.example');
const source = await readFile(sourcePath, 'utf8');

validateConfiguration(source);
if (process.argv.includes('--config-only')) {
  console.log('Nginx configuration passed upload-boundary and unified-error checks.');
} else {
  await runBoundaryTest(source);
}

async function runBoundaryTest(configuration) {
  const receivedFileSizes = [];
  const upstream = http.createServer((request, response) => {
    let receivedBytes = 0;
    request.on('data', (chunk) => { receivedBytes += chunk.length; });
    request.on('end', () => {
      if (request.method !== 'POST') return json(response, 200, { code: 0, message: 'success', data: { status: 'ok' } });
      const fileSize = Number(request.headers['x-test-file-size']);
      receivedFileSizes.push(fileSize);
      if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
        return json(response, 400, { code: 40001, message: 'Invalid test size', data: {} });
      }
      if (fileSize > applicationLimit) {
        return json(response, 413, { code: 41301, message: 'File size exceeds upload limit', data: {} });
      }
      return json(response, 200, { code: 0, message: 'success', data: { fileSize, receivedBytes } });
    });
  });
  const upstreamPort = await listen(upstream);
  const proxyPort = await availablePort();
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'finance-agent-nginx-'));
  const configPath = path.join(temporaryRoot, 'nginx.conf');
  const containerName = `finance-agent-nginx-test-${randomUUID().slice(0, 8)}`;
  await writeFile(configPath, testConfiguration(configuration, upstreamPort), 'utf8');

  try {
    const started = spawnSync('docker', [
      'run', '--detach', '--name', containerName,
      '--add-host', 'host.docker.internal:host-gateway',
      '--publish', `127.0.0.1:${proxyPort}:8080`,
      '--user', '101:101', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true', '--pids-limit', '128',
      '--memory', '256m', '--cpus', '1.0', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m,mode=1777',
      '--volume', `${configPath}:/etc/nginx/nginx.conf:ro`,
      '--entrypoint', 'nginx', nginxImage, '-g', 'daemon off;'
    ], { encoding: 'utf8', windowsHide: true });
    if (started.status !== 0) throw new Error(`Could not start Nginx test container: ${started.stderr}`);
    await waitForProxy(proxyPort);

    await expectUpload(proxyPort, 19 * MiB, 200, 0);
    await expectUpload(proxyPort, 50 * MiB, 200, 0);
    await expectUpload(proxyPort, 50 * MiB + 1, 413, 41301);
    await expectUpload(proxyPort, 53 * MiB, 413, 41301);

    if (receivedFileSizes.join(',') !== [19 * MiB, 50 * MiB, 50 * MiB + 1].join(',')) {
      throw new Error(`Unexpected upstream request sizes: ${receivedFileSizes.join(',')}`);
    }
    const residue = spawnSync('docker', [
      'exec', containerName, 'sh', '-c', 'find /tmp/nginx-client-body -type f 2>/dev/null | wc -l'
    ], { encoding: 'utf8', windowsHide: true });
    if (residue.status !== 0 || Number(residue.stdout.trim()) !== 0) {
      throw new Error(`Nginx request buffering left temporary files: ${residue.stdout || residue.stderr}`);
    }

    await close(upstream);
    const gateway = await fetch(`http://127.0.0.1:${proxyPort}/api/unavailable`, { signal: AbortSignal.timeout(10_000) });
    const gatewayBody = await gateway.json();
    if (gateway.status !== 503 || gatewayBody.code !== 50001) {
      throw new Error(`Nginx gateway error was not normalized: ${gateway.status} ${JSON.stringify(gatewayBody)}`);
    }
    console.log('Nginx boundary test passed: 19/50 MiB accepted, oversized requests rejected, no temp residue, gateway JSON normalized.');
  } catch (error) {
    const logs = spawnSync('docker', ['logs', '--tail', '100', containerName], { encoding: 'utf8', windowsHide: true });
    if (logs.stdout) console.error(logs.stdout);
    if (logs.stderr) console.error(logs.stderr);
    throw error;
  } finally {
    await close(upstream).catch(() => undefined);
    spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore', windowsHide: true });
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function validateConfiguration(configuration) {
  assert(/client_max_body_size\s+52m;/.test(configuration), 'Nginx must reserve multipart overhead above the 50 MiB application limit.');
  assert(/error_page\s+413\s+=\s+@payload_too_large;/.test(configuration), 'Nginx 413 error mapping is missing.');
  assert(configuration.includes('"code":41301'), 'Nginx 413 response is not a unified JSON envelope.');
  assert(/error_page\s+502\s+503\s+504\s+=\s+@gateway_unavailable;/.test(configuration), 'Nginx gateway error mapping is missing.');
  assert(configuration.includes('"code":50001'), 'Nginx gateway response is not a unified JSON envelope.');
  assert(configuration.includes('proxy_request_buffering on;'), 'Nginx upload buffering policy must be explicit.');
  assert(configuration.includes('proxy_temp_path /tmp/nginx-proxy'), 'Nginx proxy temp path must support a read-only root filesystem.');
  for (const pathName of ['nginx-fastcgi', 'nginx-uwsgi', 'nginx-scgi']) {
    assert(configuration.includes(pathName), `Nginx read-only temp path is missing: ${pathName}`);
  }
  assert(configuration.includes('proxy_connect_timeout 5s;'), 'Nginx connect timeout is missing.');
  assert(configuration.includes('proxy_send_timeout 120s;'), 'Nginx send timeout is missing.');
  assert(configuration.includes('proxy_read_timeout 120s;'), 'Nginx read timeout is missing.');
}

function testConfiguration(configuration, upstreamPort) {
  const server = configuration
    .replace('listen 443 ssl http2;', 'listen 8080;')
    .replace(/^\s*ssl_certificate .*;\r?\n/gm, '')
    .replace(/^\s*ssl_certificate_key .*;\r?\n/gm, '')
    .replace('http://127.0.0.1:3001', `http://host.docker.internal:${upstreamPort}`);
  return `pid /tmp/nginx.pid;\nevents {}\nhttp {\n${server}\n}\n`;
}

async function expectUpload(port, size, expectedStatus, expectedCode) {
  const form = new FormData();
  form.set('file', new Blob([Buffer.alloc(size, 0x61)], { type: 'text/csv' }), `boundary-${size}.csv`);
  form.set('projectId', 'proxy-boundary-test');
  const response = await fetch(`http://127.0.0.1:${port}/api/upload`, {
    method: 'POST',
    headers: { 'X-Test-File-Size': String(size) },
    body: form,
    signal: AbortSignal.timeout(120_000)
  });
  const body = await response.json();
  if (response.status !== expectedStatus || body.code !== expectedCode) {
    throw new Error(`Upload ${size} returned ${response.status}/${body.code}; expected ${expectedStatus}/${expectedCode}.`);
  }
}

async function waitForProxy(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/probe`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Nginx can briefly refuse connections while its worker starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for Nginx boundary test proxy.');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve(server.address().port));
  });
}

async function availablePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
