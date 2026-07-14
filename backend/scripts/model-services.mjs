import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyModelAssets } from './verify-model-assets.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const deploymentDirectory = path.join(repositoryRoot, 'deploy', 'model-services');
const composeFile = path.join(deploymentDirectory, 'compose.yaml');
const envFile = path.join(deploymentDirectory, '.env');
const exampleEnvFile = path.join(deploymentDirectory, '.env.example');

const onDemandServices = {
  vl: {
    profile: 'vl',
    service: 'qwen-vl',
    endpoint: 'http://127.0.0.1:8001/v1/models',
    model: 'Qwen/Qwen3-VL-8B-Instruct'
  },
  embedding: {
    profile: 'embedding',
    service: 'qwen-embedding',
    endpoint: 'http://127.0.0.1:8002/v1/models',
    model: 'Qwen/Qwen3-Embedding-8B'
  }
};

async function main() {
  const [command = 'status', argument] = process.argv.slice(2);
  if (command === 'init') return initializeEnvironment();
  if (command === 'check') return checkAssets(argument ?? 'resident');

  const environment = await loadEnvironment();
  ensureDocker();

  if (command === 'start-resident') return startResident(environment);
  if (command === 'start-on-demand') return startOnDemand(argument, environment);
  if (command === 'stop-on-demand') return stopOnDemand(environment);
  if (command === 'status') return status(environment);
  if (command === 'stop-all') return stopAll();
  if (command === 'logs') return logs(argument);

  throw new Error('Usage: model-services.mjs init|check [scope]|start-resident|start-on-demand <vl|embedding>|stop-on-demand|status|logs [service]|stop-all');
}

async function initializeEnvironment() {
  try {
    await access(envFile);
    console.log(`Configuration already exists: ${envFile}`);
    return;
  } catch {
    // Create the local-only file below.
  }

  const modelRoot = path.join(repositoryRoot, 'model').replaceAll('\\', '/');
  const secret = randomBytes(32).toString('hex');
  const template = await readFile(exampleEnvFile, 'utf8');
  const content = template
    .replace(/^MODEL_ROOT=.*$/m, `MODEL_ROOT=${modelRoot}`)
    .replace(/^LOCAL_MODEL_API_KEY=.*$/m, `LOCAL_MODEL_API_KEY=${secret}`);
  await writeFile(envFile, content, { encoding: 'utf8', flag: 'wx' });
  console.log(`Created local model configuration: ${envFile}`);
  console.log('The generated API key is stored only in the ignored local .env file.');
}

async function checkAssets(scope) {
  const environment = await loadEnvironment({ optional: true });
  const report = await verifyModelAssets({
    scope,
    modelRoot: environment.MODEL_ROOT || path.join(repositoryRoot, 'model')
  });
  printAssetReport(report);
  if (!report.ok) throw new Error(`Model asset check failed for scope: ${scope}`);
}

async function startResident(environment) {
  await requireAssets('resident', environment);
  compose(['up', '-d', '--build', 'qwen-text', 'paddle-ocr']);
  const timeoutMs = startTimeout(environment);
  try {
    await Promise.all([
      waitForOpenAiModel('http://127.0.0.1:8000/v1/models', 'Qwen/Qwen3-14B-AWQ', environment.LOCAL_MODEL_API_KEY, timeoutMs),
      waitForJsonHealth('http://127.0.0.1:8868/health', timeoutMs)
    ]);
  } catch (error) {
    compose(['logs', '--tail', '100', 'qwen-text', 'paddle-ocr'], { allowFailure: true });
    throw error;
  }
  console.log('Resident model services are ready: qwen-text and paddle-ocr.');
}

async function startOnDemand(kind, environment) {
  const definition = onDemandServices[kind];
  if (!definition) throw new Error('On-demand model must be one of: vl, embedding.');
  await requireAssets(kind, environment);

  console.log(`Stopping qwen-text before loading ${definition.service} on the shared GPU.`);
  compose(['stop', 'qwen-text'], { allowFailure: true });
  try {
    compose(['--profile', definition.profile, 'up', '-d', definition.service]);
    await waitForOpenAiModel(
      definition.endpoint,
      definition.model,
      environment.LOCAL_MODEL_API_KEY,
      startTimeout(environment)
    );
    console.log(`${definition.service} is ready. Paddle OCR remains resident.`);
  } catch (error) {
    console.error(`${definition.service} did not become ready; restoring qwen-text.`);
    compose(['--profile', definition.profile, 'logs', '--tail', '100', definition.service], { allowFailure: true });
    compose(['up', '-d', 'qwen-text'], { allowFailure: true });
    throw error;
  }
}

async function stopOnDemand(environment) {
  compose(['--profile', 'vl', '--profile', 'embedding', 'stop', 'qwen-vl', 'qwen-embedding'], { allowFailure: true });
  await requireAssets('text', environment);
  compose(['up', '-d', 'qwen-text']);
  await waitForOpenAiModel(
    'http://127.0.0.1:8000/v1/models',
    'Qwen/Qwen3-14B-AWQ',
    environment.LOCAL_MODEL_API_KEY,
    startTimeout(environment)
  );
  console.log('On-demand services are stopped and qwen-text is ready again.');
}

async function status(environment) {
  compose(['--profile', 'vl', '--profile', 'embedding', 'ps'], { allowFailure: true });
  const endpoints = [
    ['qwen-text', 'http://127.0.0.1:8000/v1/models', environment.LOCAL_MODEL_API_KEY],
    ['paddle-ocr', 'http://127.0.0.1:8868/health'],
    ['qwen-vl', 'http://127.0.0.1:8001/v1/models', environment.LOCAL_MODEL_API_KEY],
    ['qwen-embedding', 'http://127.0.0.1:8002/v1/models', environment.LOCAL_MODEL_API_KEY]
  ];
  for (const [name, url, apiKey] of endpoints) {
    const healthy = await endpointAvailable(url, apiKey);
    console.log(`${healthy ? 'ready' : 'offline'}\t${name}\t${url}`);
  }
}

function stopAll() {
  compose(['--profile', 'vl', '--profile', 'embedding', 'down']);
}

function logs(service) {
  const allowed = new Set(['qwen-text', 'paddle-ocr', 'qwen-vl', 'qwen-embedding']);
  if (service && !allowed.has(service)) throw new Error(`Unknown service: ${service}`);
  const args = ['--profile', 'vl', '--profile', 'embedding', 'logs', '--tail', '200'];
  if (service) args.push(service);
  compose(args);
}

async function requireAssets(scope, environment) {
  const report = await verifyModelAssets({ scope, modelRoot: environment.MODEL_ROOT });
  printAssetReport(report);
  if (!report.ok) throw new Error(`Refusing to start because ${scope} model assets are incomplete.`);
}

function printAssetReport(report) {
  console.log(`Model root: ${report.modelRoot}`);
  for (const model of report.models) {
    console.log(`${model.ok ? 'OK' : 'FAIL'} ${model.key}${model.sizeGiB === undefined ? '' : ` (${model.sizeGiB} GiB)`}`);
    for (const warning of model.warnings) console.log(`  warning: ${warning}`);
    for (const error of model.errors) console.error(`  error: ${error}`);
  }
}

function compose(arguments_, options = {}) {
  const result = spawnSync('docker', [
    'compose',
    '--env-file', envFile,
    '-f', composeFile,
    ...arguments_
  ], { cwd: deploymentDirectory, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) throw new Error(`docker compose exited with code ${result.status}.`);
  return result.status === 0;
}

function ensureDocker() {
  const docker = spawnSync('docker', ['version'], { stdio: 'ignore' });
  if (docker.error?.code === 'ENOENT') {
    throw new Error('Docker is not installed. Install Docker Desktop with WSL 2 support before starting model services.');
  }
  if (docker.status !== 0) throw new Error('Docker is installed but the daemon is not available. Start Docker Desktop and retry.');
  const composeVersion = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
  if (composeVersion.status !== 0) throw new Error('Docker Compose v2 is required.');
}

async function loadEnvironment(options = {}) {
  try {
    const source = await readFile(envFile, 'utf8');
    const parsed = parseEnv(source);
    if (!parsed.MODEL_ROOT) throw new Error(`MODEL_ROOT is required in ${envFile}.`);
    if (!parsed.LOCAL_MODEL_API_KEY || parsed.LOCAL_MODEL_API_KEY.length < 32) {
      throw new Error(`LOCAL_MODEL_API_KEY must contain at least 32 characters in ${envFile}.`);
    }
    return { ...process.env, ...parsed };
  } catch (error) {
    if (options.optional && error?.code === 'ENOENT') return { ...process.env };
    if (error?.code === 'ENOENT') throw new Error(`Missing ${envFile}. Run "npm run model:init" first.`);
    throw error;
  }
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function startTimeout(environment) {
  const value = Number(environment.MODEL_START_TIMEOUT_MS ?? 900000);
  if (!Number.isInteger(value) || value < 10000 || value > 3600000) {
    throw new Error('MODEL_START_TIMEOUT_MS must be an integer between 10000 and 3600000.');
  }
  return value;
}

async function waitForOpenAiModel(url, expectedModel, apiKey, timeoutMs) {
  await waitFor(async () => {
    const response = await request(url, apiKey, 5000);
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    return Array.isArray(payload.data) && payload.data.some((item) => item?.id === expectedModel);
  }, `${expectedModel} at ${url}`, timeoutMs);
}

async function waitForJsonHealth(url, timeoutMs) {
  await waitFor(async () => {
    const response = await request(url, undefined, 5000);
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    return payload.status === 'ok';
  }, `health endpoint ${url}`, timeoutMs);
}

async function waitFor(check, label, timeoutMs) {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    try {
      if (await check()) {
        console.log(`Ready: ${label}`);
        return;
      }
    } catch {
      // Model servers commonly refuse connections while weights are loading.
    }
    if (attempt === 1 || attempt % 6 === 0) console.log(`Waiting for ${label} (${Math.round((Date.now() - startedAt) / 1000)}s)...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label}.`);
}

async function endpointAvailable(url, apiKey) {
  try {
    return (await request(url, apiKey, 2000)).ok;
  } catch {
    return false;
  }
}

function request(url, apiKey, timeoutMs) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
