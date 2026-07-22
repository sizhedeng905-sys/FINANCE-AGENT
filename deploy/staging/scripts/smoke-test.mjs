import { request as httpsRequest } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...parseEnvironmentSource(await readFile(join(stagingRoot, '.env'), 'utf8'), 'staging environment'),
  ...process.env,
};
const settings = resolveDeploymentEnvironment(env);
const port = settings.webPort;
const ca = await readFile(join(stagingRoot, '.runtime', 'tls', 'ca.crt'));
const password = (await readFile(join(stagingRoot, '.secrets', 'staging_seed_password'), 'utf8')).trim();
const checks = [];

const frontend = await request('/');
assert(frontend.status === 200 && /<div id="root">/.test(frontend.body), 'frontend');
checks.push({ name: 'frontend', status: frontend.status });

const live = await request('/api/health/live');
assert(live.status === 200 && JSON.parse(live.body).data?.status === 'ok', 'liveness');
checks.push({ name: 'liveness', status: live.status });

const ready = await request('/api/health/ready');
const readyBody = JSON.parse(ready.body);
assert(ready.status === 200 && readyBody.data?.checks?.redis?.worker?.status === 'ok', 'readiness');
checks.push({ name: 'readiness', status: ready.status, worker: 'ok' });

for (const [username, role] of [
  ['uat-employee', 'employee'],
  ['uat-finance', 'finance'],
  ['uat-reviewer', 'reviewer'],
  ['uat-boss', 'boss']
]) {
  const login = await request('/api/auth/login', 'POST', { username, password });
  const body = JSON.parse(login.body);
  assert(login.status === 200 && body.data?.user?.role === role && body.data?.accessToken, `login:${role}`);
  checks.push({ name: `login:${role}`, status: login.status });
}

const rejected = await request('/api/auth/login', 'POST', { username: 'uat-finance', password: `${password}-wrong` });
assert(rejected.status === 401 && JSON.parse(rejected.body).code === 40101, 'invalid-login');
checks.push({ name: 'invalid-login', status: rejected.status });

const metrics = runCompose([
  'exec', '-T', 'backend-api', 'node', '-e',
  "const fs=require('fs');const t=fs.readFileSync('/run/secrets/metrics_token','utf8').trim();fetch('http://127.0.0.1:3001/api/metrics',{headers:{authorization:'Bearer '+t}}).then(async r=>{const b=await r.text();if(!r.ok||!b.includes('finance_agent_worker_heartbeat_healthy 1'))process.exit(1)})"
]);
assert(metrics.status === 0, 'metrics');
checks.push({ name: 'metrics', status: 200 });

const result = {
  status: 'passed',
  completedAt: new Date().toISOString(),
  endpoint: settings.appBaseUrl,
  checks
};
const evidenceRoot = join(stagingRoot, '.evidence');
await mkdir(evidenceRoot, { recursive: true });
await writeFile(join(evidenceRoot, 'smoke-test.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result, null, 2) + '\n');

function request(path, method = 'GET', payload) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolvePromise, reject) => {
    const operation = httpsRequest({
      hostname: settings.gatewayProbeAddress,
      port,
      path,
      method,
      ca,
      servername: settings.appDomain,
      headers: {
        Host: `${settings.appDomain}:${port}`,
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolvePromise({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    operation.on('error', reject);
    if (body) operation.write(body);
    operation.end();
  });
}

function runCompose(args) {
  return spawnSync('docker', ['compose', '--env-file', '.env', '-f', 'compose.yaml', ...args], {
    cwd: stagingRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function assert(condition, name) {
  if (!condition) throw new Error(`Staging smoke check failed: ${name}`);
}
