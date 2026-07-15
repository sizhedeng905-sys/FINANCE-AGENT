import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { PDFDocument, StandardFonts } from 'pdf-lib';

const backendRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(backendRoot, '..');
const privateRoot = resolve(repositoryRoot, '.realdata-test');
const deploymentRoot = resolve(repositoryRoot, 'deploy/model-services');
const composeFile = resolve(deploymentRoot, 'compose.yaml');
const envFile = resolve(deploymentRoot, '.env');
const modelServicesScript = resolve(backendRoot, 'scripts/model-services.mjs');
const outputPath = resolve(repositoryRoot, readArgument('--output') || '.realdata-test/reports/model-resilience.local.json');
const modelEnvironment = parseEnv(await readFile(envFile, 'utf8'));
const apiKey = modelEnvironment.LOCAL_MODEL_API_KEY;
const timeoutMs = boundedInteger(modelEnvironment.MODEL_START_TIMEOUT_MS, 900_000, 10_000, 3_600_000);

assertPrivateOutput(outputPath);
if (!apiKey || apiKey.length < 32) throw new Error('LOCAL_MODEL_API_KEY must contain at least 32 characters.');

const report = {
  generatedAt: new Date().toISOString(),
  restart: {},
  vlSwitch: {},
  restore: {},
  concurrentInference: {},
  finalServices: {},
  passed: false
};
let restoreRequired = false;

try {
  await waitForModel('http://127.0.0.1:8000/v1/models', 'Qwen/Qwen3-14B-AWQ', timeoutMs);
  await assertOcrReady();

  const restartStartedAt = performance.now();
  const restartMonitor = await monitorOcrWhile(async () => {
    await run('docker', composeArguments('restart', 'qwen-text'), deploymentRoot);
    await waitForModel('http://127.0.0.1:8000/v1/models', 'Qwen/Qwen3-14B-AWQ', timeoutMs);
  });
  report.restart = {
    recoveryMs: rounded(performance.now() - restartStartedAt),
    ocrHealthSamples: restartMonitor.samples,
    ocrHealthFailures: restartMonitor.failures,
    qwenText: await containerState('qwen-text'),
    paddleOcr: await containerState('paddle-ocr')
  };
  assertNoOcrFailure('text restart', restartMonitor);

  restoreRequired = true;
  const switchStartedAt = performance.now();
  const switchMonitor = await monitorOcrWhile(async () => {
    await run(process.execPath, [modelServicesScript, 'start-on-demand', 'vl'], repositoryRoot);
    await waitForModel('http://127.0.0.1:8001/v1/models', 'Qwen/Qwen3-VL-8B-Instruct', timeoutMs);
  });
  report.vlSwitch = {
    readyMs: rounded(performance.now() - switchStartedAt),
    ocrHealthSamples: switchMonitor.samples,
    ocrHealthFailures: switchMonitor.failures,
    textEndpointOffline: await endpointUnavailable('http://127.0.0.1:8000/v1/models', apiKey),
    qwenText: await containerState('qwen-text'),
    qwenVl: await containerState('qwen-vl'),
    paddleOcr: await containerState('paddle-ocr')
  };
  assertNoOcrFailure('VL switch', switchMonitor);
  if (!report.vlSwitch.textEndpointOffline) throw new Error('Qwen text endpoint remained online during the exclusive VL profile.');

  const restoreStartedAt = performance.now();
  const restoreMonitor = await monitorOcrWhile(async () => {
    await run(process.execPath, [modelServicesScript, 'stop-on-demand'], repositoryRoot);
    await waitForModel('http://127.0.0.1:8000/v1/models', 'Qwen/Qwen3-14B-AWQ', timeoutMs);
  });
  restoreRequired = false;
  report.restore = {
    readyMs: rounded(performance.now() - restoreStartedAt),
    ocrHealthSamples: restoreMonitor.samples,
    ocrHealthFailures: restoreMonitor.failures,
    vlEndpointOffline: await endpointUnavailable('http://127.0.0.1:8001/v1/models', apiKey),
    qwenText: await containerState('qwen-text'),
    qwenVl: await containerState('qwen-vl'),
    paddleOcr: await containerState('paddle-ocr')
  };
  assertNoOcrFailure('text restore', restoreMonitor);
  if (!report.restore.vlEndpointOffline) throw new Error('Qwen VL endpoint remained online after restoring resident services.');

  report.concurrentInference = await runConcurrentInference();
  report.finalServices = {
    qwenText: await containerState('qwen-text'),
    paddleOcr: await containerState('paddle-ocr'),
    qwenVl: await containerState('qwen-vl'),
    qwenEmbedding: await containerState('qwen-embedding')
  };
  const residentStates = [report.finalServices.qwenText, report.finalServices.paddleOcr];
  if (residentStates.some((state) => !state.running || state.oomKilled)) {
    throw new Error('A resident model service is not running or was OOM-killed.');
  }
  if (report.finalServices.qwenVl.running || report.finalServices.qwenEmbedding.running) {
    throw new Error('An on-demand model remained running after restore.');
  }
  report.passed = true;
} finally {
  if (restoreRequired) {
    await run(process.execPath, [modelServicesScript, 'stop-on-demand'], repositoryRoot).catch(() => undefined);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  passed: report.passed,
  restart: report.restart,
  vlSwitch: report.vlSwitch,
  restore: report.restore,
  concurrentInference: report.concurrentInference,
  finalServices: report.finalServices,
  output: outputPath
}, null, 2));

async function runConcurrentInference() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([420, 300]);
  page.drawText('Date: 2026-07-15', { x: 40, y: 230, size: 18, font });
  page.drawText('Amount: 128.50', { x: 40, y: 190, size: 18, font });
  const bytes = await pdf.save();
  const fields = [
    { fieldKey: 'record_date', fieldName: 'Date', fieldType: 'date', semanticType: 'date', aliases: ['Date'] },
    { fieldKey: 'amount', fieldName: 'Amount', fieldType: 'money', semanticType: 'amount', aliases: ['Amount'] }
  ];

  const startedAt = performance.now();
  const [ai, ocr] = await Promise.all([
    timed(async () => {
      const response = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'Qwen/Qwen3-14B-AWQ',
          temperature: 0,
          max_tokens: 32,
          chat_template_kwargs: { enable_thinking: false },
          messages: [{ role: 'user', content: 'Reply with the single word ready.' }]
        }),
        signal: AbortSignal.timeout(300_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload?.choices?.[0]?.message?.content !== 'string') {
        throw new Error(`Qwen concurrent inference failed with HTTP ${response.status}.`);
      }
      return { status: response.status };
    }),
    timed(async () => {
      const body = new FormData();
      body.set('file', new Blob([bytes], { type: 'application/pdf' }), 'synthetic-resilience.pdf');
      body.set('documentId', 'synthetic-resilience');
      body.set('templateFields', JSON.stringify(fields));
      const response = await fetch('http://127.0.0.1:8868/ocr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(300_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.documentId !== 'synthetic-resilience' || !Array.isArray(payload?.fieldCandidates)) {
        throw new Error(`OCR concurrent inference failed with HTTP ${response.status}.`);
      }
      return { status: response.status, fieldCandidateCount: payload.fieldCandidates.length };
    })
  ]);
  return {
    passed: true,
    wallClockMs: rounded(performance.now() - startedAt),
    ai: { status: ai.value.status, durationMs: ai.durationMs },
    ocr: {
      status: ocr.value.status,
      durationMs: ocr.durationMs,
      fieldCandidateCount: ocr.value.fieldCandidateCount
    }
  };
}

async function monitorOcrWhile(operation) {
  let monitoring = true;
  const result = { samples: 0, failures: 0, maxLatencyMs: 0 };
  const monitor = (async () => {
    while (monitoring) {
      const startedAt = performance.now();
      try {
        await assertOcrReady();
      } catch {
        result.failures += 1;
      }
      result.samples += 1;
      result.maxLatencyMs = Math.max(result.maxLatencyMs, performance.now() - startedAt);
      if (monitoring) await delay(1_000);
    }
  })();
  try {
    await operation();
  } finally {
    monitoring = false;
    await monitor;
  }
  result.maxLatencyMs = rounded(result.maxLatencyMs);
  return result;
}

async function assertOcrReady() {
  const response = await fetch('http://127.0.0.1:8868/health', { signal: AbortSignal.timeout(5_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status !== 'ok') throw new Error('Paddle OCR health check failed.');
}

async function waitForModel(url, expectedModel, deadlineMs) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < deadlineMs) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(payload.data) && payload.data.some((item) => item?.id === expectedModel)) return;
    } catch {
      // Model endpoints refuse connections while weights are loading.
    }
    await delay(2_000);
  }
  throw new Error(`Timed out waiting for ${expectedModel}.`);
}

async function endpointUnavailable(url, key) {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(2_000)
    });
    return !response.ok;
  } catch {
    return true;
  }
}

async function containerState(service) {
  const id = (await capture('docker', composeArguments('ps', '-aq', service), deploymentRoot)).trim();
  if (!id) return { present: false, running: false, status: 'absent', health: 'none', oomKilled: false, restartCount: 0 };
  const value = JSON.parse(await capture('docker', ['inspect', id, '--format', '{{json .}}'], deploymentRoot));
  return {
    present: true,
    running: value.State?.Running === true,
    status: value.State?.Status ?? 'unknown',
    health: value.State?.Health?.Status ?? 'none',
    oomKilled: value.State?.OOMKilled === true,
    restartCount: Number(value.RestartCount ?? 0)
  };
}

function composeArguments(...args) {
  return ['compose', '--env-file', envFile, '-f', composeFile, ...args];
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}.`));
    });
  });
}

function capture(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}: ${Buffer.concat(stderr).toString('utf8').slice(-1000)}`));
    });
  });
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: rounded(performance.now() - startedAt) };
}

function assertNoOcrFailure(label, monitor) {
  if (monitor.samples < 1 || monitor.failures !== 0) {
    throw new Error(`Paddle OCR was unavailable during ${label}.`);
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

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('MODEL_START_TIMEOUT_MS is invalid.');
  return parsed;
}

function assertPrivateOutput(path) {
  if (path !== privateRoot && !path.startsWith(`${privateRoot}${sep}`)) {
    throw new Error('Model resilience output must stay under .realdata-test/.');
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}
