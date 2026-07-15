import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const CONTAINERS = [
  { key: 'text', name: 'finance-agent-models-qwen-text-1', healthUrl: 'http://127.0.0.1:8000/health' },
  { key: 'ocr', name: 'finance-agent-models-paddle-ocr-1', healthUrl: 'http://127.0.0.1:8868/health' }
];

async function main() {
  const options = parseOptions(process.argv.slice(2));
  assertLocalPath(options.output, 'Model soak output');
  const startedAt = new Date();
  const deadline = Date.now() + options.durationMs;
  const initial = await inspectContainers();
  const samples = [];

  while (true) {
    const [containers, gpu, endpoints] = await Promise.all([
      inspectContainers(),
      inspectGpu(),
      inspectEndpoints(options.requestTimeoutMs)
    ]);
    samples.push({ at: new Date().toISOString(), containers, gpu, endpoints });
    if (Date.now() >= deadline) break;
    await delay(Math.min(options.intervalMs, Math.max(0, deadline - Date.now())));
  }

  const final = await inspectContainers();
  const logSignals = await inspectLogs(startedAt);
  const checks = {
    endpointSamplesHealthy: samples.every((sample) => Object.values(sample.endpoints).every(Boolean)),
    containerSamplesHealthy: samples.every((sample) => Object.values(sample.containers).every((item) => (
      item.running && item.health === 'healthy' && !item.oomKilled && !item.restarting
    ))),
    restartCountsUnchanged: CONTAINERS.every(({ key }) => initial[key].restartCount === final[key].restartCount),
    noOomSignals: Object.values(logSignals).every((item) => item.oomSignals === 0),
    noFatalSignals: Object.values(logSignals).every((item) => item.fatalSignals === 0)
  };
  const gpuSamples = samples.map((sample) => sample.gpu).filter(Boolean);
  const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    requestedDurationMs: options.durationMs,
    observedDurationMs: Date.now() - startedAt.getTime(),
    intervalMs: options.intervalMs,
    sampleCount: samples.length,
    checks,
    passed: Object.values(checks).every(Boolean),
    containers: { initial, final, logSignals },
    gpu: {
      samples: gpuSamples.length,
      maxMemoryUsedMiB: maximum(gpuSamples, 'memoryUsedMiB'),
      minMemoryFreeMiB: minimum(gpuSamples, 'memoryFreeMiB'),
      maxUtilizationPercent: maximum(gpuSamples, 'utilizationPercent'),
      maxTemperatureCelsius: maximum(gpuSamples, 'temperatureCelsius')
    },
    samples
  };
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    passed: report.passed,
    requestedDurationMs: report.requestedDurationMs,
    observedDurationMs: report.observedDurationMs,
    sampleCount: report.sampleCount,
    checks: report.checks,
    gpu: report.gpu
  }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

function parseOptions(args) {
  const repositoryRoot = resolve(process.cwd(), '..');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid CLI argument near ${key}`);
    values.set(key, value);
  }
  const durationMinutes = numberOption(values.get('--duration-minutes'), 30, 0.1, 1440, '--duration-minutes');
  const intervalSeconds = numberOption(values.get('--interval-seconds'), 30, 1, 300, '--interval-seconds');
  const requestTimeoutSeconds = numberOption(values.get('--request-timeout-seconds'), 5, 1, 60, '--request-timeout-seconds');
  return {
    durationMs: Math.round(durationMinutes * 60_000),
    intervalMs: Math.round(intervalSeconds * 1000),
    requestTimeoutMs: Math.round(requestTimeoutSeconds * 1000),
    output: resolve(repositoryRoot, values.get('--output') ?? '.realdata-test/reports/model-resident-soak.local.json')
  };
}

async function inspectContainers() {
  const result = {};
  for (const container of CONTAINERS) {
    const { stdout } = await execute('docker', ['inspect', container.name], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const value = JSON.parse(stdout)[0];
    result[container.key] = {
      running: value?.State?.Running === true,
      health: value?.State?.Health?.Status ?? 'none',
      restarting: value?.State?.Restarting === true,
      oomKilled: value?.State?.OOMKilled === true,
      restartCount: Number(value?.RestartCount ?? 0),
      startedAt: value?.State?.StartedAt ?? null
    };
  }
  return result;
}

async function inspectEndpoints(timeoutMs) {
  const result = {};
  await Promise.all(CONTAINERS.map(async (container) => {
    try {
      const response = await fetch(container.healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
      result[container.key] = response.ok;
    } catch {
      result[container.key] = false;
    }
  }));
  return result;
}

async function inspectGpu() {
  try {
    const { stdout } = await execute('nvidia-smi', [
      '--query-gpu=memory.used,memory.free,utilization.gpu,temperature.gpu',
      '--format=csv,noheader,nounits'
    ], { windowsHide: true, timeout: 10_000 });
    const values = stdout.trim().split(',').map((item) => Number(item.trim()));
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
    return {
      memoryUsedMiB: values[0],
      memoryFreeMiB: values[1],
      utilizationPercent: values[2],
      temperatureCelsius: values[3]
    };
  } catch {
    return null;
  }
}

async function inspectLogs(startedAt) {
  const result = {};
  for (const container of CONTAINERS) {
    let source = '';
    try {
      const output = await execute('docker', ['logs', '--since', startedAt.toISOString(), container.name], {
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
      });
      source = `${output.stdout}\n${output.stderr}`;
    } catch (error) {
      source = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    }
    result[container.key] = {
      oomSignals: matches(source, /(?:out of memory|cuda[^\r\n]{0,80}memory|oom[-_ ]?killed)/gi),
      fatalSignals: matches(source, /(?:fatal error|segmentation fault|core dumped)/gi)
    };
  }
  return result;
}

function assertLocalPath(path, label) {
  const localRoot = resolve(process.cwd(), '..', '.realdata-test');
  const relation = relative(localRoot, resolve(path));
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} must stay inside .realdata-test`);
  }
}

function numberOption(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} is invalid`);
  return parsed;
}

function maximum(items, key) {
  return items.length ? Math.max(...items.map((item) => item[key])) : null;
}

function minimum(items, key) {
  return items.length ? Math.min(...items.map((item) => item[key])) : null;
}

function matches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

void main().catch((error) => {
  process.stderr.write(`Resident model soak failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
