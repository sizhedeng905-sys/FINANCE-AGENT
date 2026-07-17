import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readModelState, withModelSwitchLock } from './model-switch-lock.mjs';
import { verifyModelAssets } from './verify-model-assets.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const deploymentDirectory = path.join(repositoryRoot, 'deploy', 'model-services');
const composeFile = path.join(deploymentDirectory, 'compose.yaml');
const envFile = path.join(deploymentDirectory, '.env');
const exampleEnvFile = path.join(deploymentDirectory, '.env.example');
const stateRoot = path.join(deploymentDirectory, '.state');
const gpuServices = ['qwen-text', 'qwen-vl', 'qwen-embedding'];
const paddleBaseImage = 'ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-vl@sha256:659eb236d509966380c0ac938049cbb3494f1e84c5d5c53fcac3572c05463487';

const textService = {
  service: 'qwen-text',
  endpoint: 'http://127.0.0.1:8000/v1/models',
  model: 'Qwen/Qwen3-14B-AWQ',
  capability: 'chat'
};

const onDemandServices = {
  vl: {
    profile: 'vl',
    service: 'qwen-vl',
    endpoint: 'http://127.0.0.1:8001/v1/models',
    model: 'Qwen/Qwen3-VL-8B-Instruct',
    capability: 'chat'
  },
  embedding: {
    profile: 'embedding',
    service: 'qwen-embedding',
    endpoint: 'http://127.0.0.1:8002/v1/models',
    model: 'Qwen/Qwen3-Embedding-8B',
    capability: 'embedding'
  }
};

async function main() {
  const [command = 'status', argument] = process.argv.slice(2);
  if (command === 'init') return initializeEnvironment();
  if (command === 'check') return checkAssets(argument ?? 'resident');

  const environment = await loadEnvironment();
  ensureDocker();

  if (command === 'status') return status(environment);
  if (command === 'logs') return logs(argument);
  const operations = {
    'start-resident': (lock) => startResident(environment, lock),
    'start-on-demand': (lock) => startOnDemand(argument, environment, lock),
    'stop-on-demand': (lock) => stopOnDemand(environment, lock),
    'stop-all': (lock) => stopAll(lock)
  };
  const operation = operations[command];
  if (!operation) {
    throw new Error('Usage: model-services.mjs init|check [scope]|start-resident|start-on-demand <vl|embedding>|stop-on-demand|status|logs [service]|stop-all');
  }
  return withModelSwitchLock({ stateRoot, operation: `${command}${argument ? `:${argument}` : ''}` }, operation);
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

async function startResident(environment, lock) {
  await lock.transition('resident_starting', { target: 'qwen-text' });
  await requireAssets('resident', environment);
  await stopAndVerify(['qwen-vl', 'qwen-embedding']);
  compose(['up', '-d', '--build', 'qwen-text', 'paddle-ocr']);
  const timeoutMs = startTimeout(environment);
  try {
    await Promise.all([
      waitForOpenAiModel(textService, environment.LOCAL_MODEL_API_KEY, timeoutMs),
      waitForPaddleReady(environment, timeoutMs)
    ]);
    await lock.transition('resident_ready', { active: ['qwen-text', 'paddle-ocr'] });
  } catch (error) {
    compose(['logs', '--tail', '100', 'qwen-text', 'paddle-ocr'], { allowFailure: true });
    await lock.transition('failed', { target: 'resident', reason: safeReason(error) });
    throw error;
  }
  console.log('Resident model services are ready: qwen-text and paddle-ocr.');
}

async function startOnDemand(kind, environment, lock) {
  const definition = onDemandServices[kind];
  if (!definition) throw new Error('On-demand model must be one of: vl, embedding.');
  await Promise.all([requireAssets(kind, environment), requireAssets('text', environment)]);
  await lock.transition('switching', { from: 'qwen-text', target: definition.service });

  console.log(`Stopping all switchable GPU services before loading ${definition.service}.`);
  await stopAndVerify(gpuServices);
  try {
    compose(['--profile', definition.profile, 'up', '-d', definition.service]);
    await waitForOpenAiModel(definition, environment.LOCAL_MODEL_API_KEY, startTimeout(environment));
    await lock.transition('on_demand_ready', { active: [definition.service, 'paddle-ocr'], target: definition.service });
    console.log(`${definition.service} is ready. Paddle OCR remains resident.`);
  } catch (switchError) {
    console.error(`${definition.service} did not become ready; restoring qwen-text.`);
    compose(['--profile', definition.profile, 'logs', '--tail', '100', definition.service], { allowFailure: true });
    await lock.transition('restoring_text', { failedTarget: definition.service });
    try {
      await stopAndVerify(['qwen-vl', 'qwen-embedding']);
      await restoreText(environment);
      await lock.transition('resident_ready', {
        active: ['qwen-text', 'paddle-ocr'],
        recoveredFrom: definition.service
      });
    } catch (restoreError) {
      await lock.transition('failed', {
        target: definition.service,
        reason: `${safeReason(switchError)}; restore failed: ${safeReason(restoreError)}`
      });
      throw new AggregateError([switchError, restoreError], 'On-demand switch and qwen-text restoration both failed.');
    }
    throw new Error(`${safeReason(switchError)} qwen-text was restored and passed its capability probe.`);
  }
}

async function stopOnDemand(environment, lock) {
  await lock.transition('restoring_text', { target: 'qwen-text' });
  await stopAndVerify(['qwen-vl', 'qwen-embedding']);
  await requireAssets('text', environment);
  await restoreText(environment);
  await lock.transition('resident_ready', { active: ['qwen-text', 'paddle-ocr'] });
  console.log('On-demand services are stopped and qwen-text is ready again.');
}

async function restoreText(environment) {
  compose(['up', '-d', 'qwen-text']);
  await waitForOpenAiModel(textService, environment.LOCAL_MODEL_API_KEY, startTimeout(environment));
}

async function stopAll(lock) {
  await lock.transition('stopping', { target: 'all' });
  compose(['--profile', 'vl', '--profile', 'embedding', 'down']);
  await lock.transition('stopped', { active: [] });
}

async function status(environment) {
  compose(['--profile', 'vl', '--profile', 'embedding', 'ps'], { allowFailure: true });
  const state = await readModelState(stateRoot);
  console.log(`state\t${state?.status ?? 'unknown'}${state?.target ? `\ttarget=${state.target}` : ''}`);
  const endpoints = [
    ['qwen-text', textService.endpoint, environment.LOCAL_MODEL_API_KEY],
    ['paddle-ocr', 'http://127.0.0.1:8868/ready', environment.LOCAL_MODEL_API_KEY],
    ['qwen-vl', onDemandServices.vl.endpoint, environment.LOCAL_MODEL_API_KEY],
    ['qwen-embedding', onDemandServices.embedding.endpoint, environment.LOCAL_MODEL_API_KEY]
  ];
  for (const [name, url, apiKey] of endpoints) {
    const healthy = await endpointAvailable(url, apiKey);
    console.log(`${healthy ? 'ready' : 'offline'}\t${name}\t${url}`);
  }
}

function logs(service) {
  const allowed = new Set(['qwen-text', 'paddle-ocr', 'qwen-vl', 'qwen-embedding']);
  if (service && !allowed.has(service)) throw new Error(`Unknown service: ${service}`);
  const args = ['--profile', 'vl', '--profile', 'embedding', 'logs', '--tail', '200'];
  if (service) args.push(service);
  compose(args);
}

async function stopAndVerify(services) {
  compose(['--profile', 'vl', '--profile', 'embedding', 'stop', ...services], { allowFailure: true });
  await waitFor(async () => services.every((service) => !serviceRunning(service)), `services to stop: ${services.join(', ')}`, 60_000, 1000);
}

function serviceRunning(service) {
  const containerId = composeOutput(['--profile', 'vl', '--profile', 'embedding', 'ps', '-q', service], { allowFailure: true }).trim();
  if (!containerId) return false;
  const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', containerId], {
    encoding: 'utf8',
    windowsHide: true
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

async function requireAssets(scope, environment) {
  const report = await verifyModelAssets({ scope, modelRoot: environment.MODEL_ROOT });
  printAssetReport(report);
  if (!report.ok) throw new Error(`Refusing to start because ${scope} model assets are incomplete.`);
}

function printAssetReport(report) {
  for (const model of report.models) {
    console.log(`${model.ok ? 'OK' : 'FAIL'} ${model.key}${model.sizeGiB === undefined ? '' : ` (${model.sizeGiB} GiB)`}`);
    for (const warning of model.warnings) console.log(`  warning: ${warning}`);
    for (const error of model.errors) console.error(`  error: ${error}`);
  }
}

function compose(arguments_, options = {}) {
  const result = spawnSync('docker', [
    'compose', '--env-file', envFile, '-f', composeFile, ...arguments_
  ], { cwd: deploymentDirectory, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) throw new Error(`docker compose exited with code ${result.status}.`);
  return result.status === 0;
}

function composeOutput(arguments_, options = {}) {
  const result = spawnSync('docker', [
    'compose', '--env-file', envFile, '-f', composeFile, ...arguments_
  ], { cwd: deploymentDirectory, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) throw new Error(`docker compose exited with code ${result.status}.`);
  return result.stdout || '';
}

function ensureDocker() {
  const docker = spawnSync('docker', ['version'], { stdio: 'ignore', windowsHide: true });
  if (docker.error?.code === 'ENOENT') {
    throw new Error('Docker is not installed. Install Docker Desktop with WSL 2 support before starting model services.');
  }
  if (docker.status !== 0) throw new Error('Docker is installed but the daemon is not available. Start Docker Desktop and retry.');
  const composeVersion = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', windowsHide: true });
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
    if (parsed.PADDLE_OCR_BASE_IMAGE && parsed.PADDLE_OCR_BASE_IMAGE !== paddleBaseImage) {
      throw new Error(`PADDLE_OCR_BASE_IMAGE must use the pinned digest from ${exampleEnvFile}.`);
    }
    const gpuUtilizations = [
      Number(parsed.ON_DEMAND_GPU_MEMORY_UTILIZATION ?? '0.72'),
      Number(parsed.QWEN_VL_GPU_MEMORY_UTILIZATION ?? '0.75')
    ];
    if (gpuUtilizations.some((value) => !Number.isFinite(value) || value < 0.5 || value > 0.82)) {
      throw new Error('On-demand GPU memory utilization must be between 0.50 and 0.82.');
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

async function waitForOpenAiModel(definition, apiKey, timeoutMs) {
  await waitFor(async () => {
    const runtime = serviceRuntimeState(definition.service);
    if (runtime && (['exited', 'dead'].includes(runtime.status) || (runtime.restarting && runtime.restartCount >= 2))) {
      throw new FatalModelStartError(`${definition.service} entered a restart loop (exit ${runtime.exitCode}).`);
    }
    const response = await request(definition.endpoint, apiKey, 5000);
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    if (!Array.isArray(payload.data) || !payload.data.some((item) => item?.id === definition.model)) return false;
    return probeOpenAiCapability(definition, apiKey);
  }, `${definition.model} identity and ${definition.capability} capability at ${definition.endpoint}`, timeoutMs);
}

async function probeOpenAiCapability(definition, apiKey) {
  const root = definition.endpoint.replace(/\/models$/, '');
  const embedding = definition.capability === 'embedding';
  const response = await request(`${root}/${embedding ? 'embeddings' : 'chat/completions'}`, apiKey, 30_000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embedding
      ? { model: definition.model, input: 'health' }
      : {
          model: definition.model,
          messages: [{ role: 'user', content: 'health' }],
          temperature: 0,
          max_tokens: 1,
          chat_template_kwargs: { enable_thinking: false }
        })
  });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => ({}));
  return embedding ? Array.isArray(payload.data) : Array.isArray(payload.choices);
}

async function waitForPaddleReady(environment, timeoutMs) {
  const expectedVersion = environment.PADDLE_OCR_PIPELINE_VERSION || 'v1';
  await waitFor(async () => {
    const response = await request('http://127.0.0.1:8868/ready', environment.LOCAL_MODEL_API_KEY, 5000);
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    return payload.status === 'ready'
      && payload.model?.name === 'PaddlePaddle/PaddleOCR-VL'
      && payload.model?.version === expectedVersion
      && Array.isArray(payload.capabilities)
      && payload.capabilities.includes('ocr_document');
  }, 'authenticated Paddle OCR identity and capability', timeoutMs);
}

async function waitFor(check, label, timeoutMs, intervalMs = 5000) {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    try {
      if (await check()) {
        console.log(`Ready: ${label}`);
        return;
      }
    } catch (error) {
      if (error instanceof FatalModelStartError) throw error;
      // Model servers commonly refuse connections while weights are loading.
    }
    if (attempt === 1 || attempt % 6 === 0) console.log(`Waiting for ${label} (${Math.round((Date.now() - startedAt) / 1000)}s)...`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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

function request(url, apiKey, timeoutMs, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
}

function safeReason(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500);
}

function serviceRuntimeState(service) {
  const containerId = composeOutput([
    '--profile', 'vl', '--profile', 'embedding', 'ps', '--all', '-q', service
  ], { allowFailure: true }).trim();
  if (!containerId) return undefined;
  const inspect = spawnSync('docker', ['inspect', containerId], { encoding: 'utf8', windowsHide: true });
  if (inspect.status !== 0) return undefined;
  const item = JSON.parse(inspect.stdout)[0];
  return {
    status: item.State?.Status,
    restarting: Boolean(item.State?.Restarting),
    exitCode: Number(item.State?.ExitCode ?? 0),
    restartCount: Number(item.RestartCount ?? 0)
  };
}

class FatalModelStartError extends Error {}

main().catch((error) => {
  console.error(safeReason(error));
  process.exitCode = 1;
});
