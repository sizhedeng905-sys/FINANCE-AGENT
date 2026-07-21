import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

const backendRoot = resolve(import.meta.dirname, '..');
const prismaRoot = resolve(backendRoot, 'prisma');
const envFile = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');
if (existsSync(envFile)) loadEnvFile(envFile);

const sourceDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required.');
const sourceUrl = new URL(sourceDatabaseUrl);
const sourceDatabase = decodeURIComponent(sourceUrl.pathname.replace(/^\//, ''));
if (!sourceDatabase.endsWith('_test')) {
  throw new Error(`System bootstrap acceptance refuses to use non-test database "${sourceDatabase}".`);
}

const suffix = `${process.pid}_${Date.now().toString(36)}`;
const databaseName = `fa_system_registry_${suffix}_test`;
const temporaryRoot = await mkdtemp(join(tmpdir(), 'finance-agent-system-registry-'));
const prismaCli = resolve(backendRoot, 'node_modules/prisma/build/index.js');
const schemaPath = resolve(prismaRoot, 'schema.prisma');
const distBootstrap = resolve(backendRoot, 'dist/system-bootstrap.js');
const distVerify = resolve(backendRoot, 'dist/system-verify.js');
const distApi = resolve(backendRoot, 'dist/main.js');
const distWorker = resolve(backendRoot, 'dist/worker.js');
const children = new Set();
const redisContainerName = `finance-agent-system-registry-redis-${suffix.replaceAll('_', '-')}`;
const redisPassword = randomBytes(24).toString('base64url');
const jwtSigningSecret = randomBytes(32).toString('base64url');
const stagingEnvironmentExample = readFileSync(resolve(backendRoot, '../deploy/staging/.env.example'), 'utf8');
const redisImage = stagingEnvironmentExample.match(/^REDIS_IMAGE=(\S+)$/m)?.[1];
if (!redisImage?.includes('@sha256:')) throw new Error('Pinned staging REDIS_IMAGE is unavailable.');
const migrationCount = (await readdir(resolve(prismaRoot, 'migrations'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .length;
let databaseCreated = false;
let redisContainerStarted = false;
let primaryFailure;
const cleanupFailures = [];

function databaseUrl(name) {
  const value = new URL(sourceUrl);
  value.pathname = `/${name}`;
  return value.toString();
}

const testDatabaseUrl = databaseUrl(databaseName);

function safeEnvironment(overrides = {}) {
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    PROCESS_ROLE: 'api',
    DATABASE_URL: testDatabaseUrl,
    JWT_SECRET: jwtSigningSecret,
    HOST: '127.0.0.1',
    AI_PROVIDER: 'mock',
    AI_PROVIDER_CLASS: 'mock',
    AI_INGESTION_MODE: 'disabled',
    AI_REPORT_MODE: 'disabled',
    AI_GLOBAL_KILL_SWITCH: 'false',
    AI_EXTERNAL_PROVIDER_MODE: 'disabled',
    AI_SYSTEM_REGISTRY_PROFILE: 'mock-safe-v1',
    AI_SYSTEM_REGISTRY_STARTUP_MODE: 'verify',
    OCR_PROVIDER: 'mock',
    FILE_STORAGE_DRIVER: 'local',
    UPLOAD_DIR: resolve(temporaryRoot, 'uploads'),
    UPLOAD_QUARANTINE_DIR: resolve(temporaryRoot, 'quarantine'),
    REQUEST_RATE_LIMIT_STORE: 'memory',
    LOGIN_RATE_LIMIT_STORE: 'memory',
    UPLOAD_ADMISSION_STORE: 'memory',
    MODEL_EXECUTION_GATE_STORE: 'memory',
    DATA_RETENTION_MODE: 'disabled',
    SWAGGER_ENABLED: 'false',
    REDIS_URL: '',
    METRICS_TOKEN: '',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
    ...overrides
  };
  for (const key of [
    'DATABASE_URL_FILE',
    'JWT_SECRET_FILE',
    'REDIS_URL_FILE',
    'AI_SYSTEM_REGISTRY_MANIFEST_JSON'
  ]) delete environment[key];
  return environment;
}

function run(args, options = {}) {
  return runExecutable(process.execPath, args, options);
}

function runAsync(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd || temporaryRoot,
      env: options.env || safeEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });
    children.add(child);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    child.once('error', (error) => {
      children.delete(child);
      rejectRun(error);
    });
    child.once('exit', (code) => {
      children.delete(child);
      if (code !== 0) {
        rejectRun(new Error(
          `Command failed with exit code ${code}: ${options.label || process.execPath}\n${stderr.join('')}`
        ));
        return;
      }
      resolveRun({ stdout: stdout.join(''), stderr: stderr.join(''), status: code });
    });
  });
}

function runExecutable(executable, args, options = {}) {
  const commandLabel = options.label || executable;
  const result = spawnSync(executable, args, {
    cwd: options.cwd || temporaryRoot,
    env: options.env || safeEnvironment(),
    input: options.input,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : options.input === undefined
      ? 'inherit'
      : ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`Command failed with exit code ${result.status}: ${commandLabel}${detail}`);
  }
  return result;
}

function executeAdmin(sql) {
  run(
    [prismaCli, 'db', 'execute', '--stdin', '--schema', schemaPath],
    { input: sql, env: { ...safeEnvironment(), DATABASE_URL: databaseUrl('postgres') } }
  );
}

function parseJsonOutput(output) {
  for (const line of String(output).trim().split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning past tool diagnostics.
    }
  }
  throw new Error('Command did not emit a JSON result.');
}

async function inspectDatabase() {
  const prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  try {
    const [
      prompts,
      deployments,
      routes,
      bootstrapAudits,
      users,
      projects,
      templates,
      fields,
      projectTemplates,
      records,
      workOrders,
      rawFiles,
      importTasks,
      ocrTasks,
      legacyModelConfigs
    ] = await Promise.all([
      prisma.aiPromptVersion.count(),
      prisma.modelDeployment.count(),
      prisma.taskModelRoute.count(),
      prisma.auditLog.count({ where: { action: 'system_registry.bootstrap' } }),
      prisma.user.count(),
      prisma.project.count(),
      prisma.template.count(),
      prisma.fieldDefinition.count(),
      prisma.projectTemplate.count(),
      prisma.businessRecord.count(),
      prisma.workOrder.count(),
      prisma.rawFile.count(),
      prisma.importTask.count(),
      prisma.ocrTask.count(),
      prisma.aiModelConfig.count()
    ]);
    return {
      system: { prompts, deployments, routes, bootstrapAudits },
      business: {
        users,
        projects,
        templates,
        fields,
        projectTemplates,
        records,
        workOrders,
        rawFiles,
        importTasks,
        ocrTasks,
        legacyModelConfigs
      }
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function setMockDeploymentTimeout(timeoutMs) {
  const prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  try {
    await prisma.modelDeployment.update({
      where: { deploymentKey: 'mock-text' },
      data: { timeoutMs }
    });
  } finally {
    await prisma.$disconnect();
  }
}

function assertCounts(counts) {
  const expectedSystem = { prompts: 11, deployments: 1, routes: 7, bootstrapAudits: 1 };
  if (JSON.stringify(counts.system) !== JSON.stringify(expectedSystem)) {
    throw new Error(`Unexpected system registry counts: ${JSON.stringify(counts.system)}.`);
  }
  const nonZeroBusiness = Object.entries(counts.business).filter(([, value]) => value !== 0);
  if (nonZeroBusiness.length) {
    throw new Error(`System bootstrap created non-system data: ${JSON.stringify(Object.fromEntries(nonZeroBusiness))}.`);
  }
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function startRedis() {
  const port = await availablePort();
  runExecutable('docker', [
    'run',
    '--detach',
    '--rm',
    '--name', redisContainerName,
    '--publish', `127.0.0.1:${port}:6379`,
    '--read-only',
    '--tmpfs', '/data:rw,noexec,nosuid,nodev,size=32m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    redisImage,
    'redis-server',
    '--requirepass', redisPassword,
    '--save', '',
    '--appendonly', 'no'
  ], { capture: true, cwd: backendRoot, label: 'temporary Redis startup' });
  redisContainerStarted = true;

  const url = `redis://:${encodeURIComponent(redisPassword)}@127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const client = createClient({ url, socket: { connectTimeout: 1_000, reconnectStrategy: false } });
    client.on('error', () => undefined);
    try {
      await client.connect();
      if (await client.ping() === 'PONG') {
        await client.quit();
        return url;
      }
    } catch {
      if (client.isOpen) client.destroy();
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error('Temporary Redis did not become ready within 30 seconds.');
}

function startProcess(entry, environment) {
  const child = spawn(process.execPath, [entry], {
    cwd: temporaryRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  children.add(child);
  const logs = [];
  const append = (chunk) => {
    logs.push(String(chunk));
    while (logs.join('').length > 32_768) logs.shift();
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('exit', () => children.delete(child));
  return { child, logs };
}

async function waitForApi(port, processState) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processState.child.exitCode !== null) {
      throw new Error(`API exited before readiness.\n${processState.logs.join('')}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/live`);
      if (response.ok) return;
    } catch {
      // Startup connection failures are expected until Nest begins listening.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`API readiness timed out.\n${processState.logs.join('')}`);
}

async function waitForWorker(processState) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const logs = processState.logs.join('');
    if (processState.child.exitCode !== null) throw new Error(`Worker exited before readiness.\n${logs}`);
    if (logs.includes('worker_ready') && logs.includes('system_registry_verified')) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Worker readiness timed out.\n${processState.logs.join('')}`);
}

async function waitForRejectedStartup(processState, expectedMessage) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processState.child.exitCode !== null) {
      const logs = processState.logs.join('');
      if (processState.child.exitCode === 0 || !logs.includes(expectedMessage)) {
        throw new Error(`Drifted API did not fail with the expected reason.\n${logs}`);
      }
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  await stopProcess(processState.child);
  throw new Error(`Drifted API did not fail before the timeout.\n${processState.logs.join('')}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000))
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

try {
  executeAdmin(`CREATE DATABASE "${databaseName}";`);
  databaseCreated = true;
  run([prismaCli, 'migrate', 'deploy', '--schema', schemaPath]);

  const concurrentBootstrapResults = await Promise.all([
    runAsync([distBootstrap], { label: 'concurrent system bootstrap A' }),
    runAsync([distBootstrap], { label: 'concurrent system bootstrap B' })
  ]);
  const bootstraps = concurrentBootstrapResults.map((result) => parseJsonOutput(result.stdout));
  const first = bootstraps.find((result) => result.status === 'changed' && result.changed === true);
  const second = bootstraps.find((result) => result.status === 'unchanged' && result.changed === false);
  if (!first || !second) {
    throw new Error(`Concurrent bootstraps did not converge to changed/unchanged: ${JSON.stringify(bootstraps)}.`);
  }

  const counts = await inspectDatabase();
  assertCounts(counts);

  const verification = parseJsonOutput(run([distVerify, '--mock-smoke'], { capture: true }).stdout);
  if (
    verification.status !== 'verified'
    || verification.mockSmoke?.provider !== 'mock'
    || verification.mockSmoke?.mappingCount !== 1
    || verification.mockSmoke?.decision !== 'NEEDS_FINANCE_REVIEW'
  ) {
    throw new Error(`Mock registry smoke failed: ${JSON.stringify(verification)}.`);
  }

  const port = await availablePort();
  const api = startProcess(distApi, safeEnvironment({ PROCESS_ROLE: 'api', PORT: String(port) }));
  await waitForApi(port, api);
  if (!api.logs.join('').includes('system_registry_verified')) {
    throw new Error(`API did not verify the system registry.\n${api.logs.join('')}`);
  }
  await stopProcess(api.child);

  const redisUrl = await startRedis();
  const worker = startProcess(distWorker, safeEnvironment({
    PROCESS_ROLE: 'worker',
    REDIS_URL: redisUrl,
    REDIS_KEY_PREFIX: `finance-agent-system-bootstrap-${suffix}`
  }));
  await waitForWorker(worker);
  await stopProcess(worker.child);

  await setMockDeploymentTimeout(9_999);
  const rejectedPort = await availablePort();
  const driftedApi = startProcess(distApi, safeEnvironment({ PROCESS_ROLE: 'api', PORT: String(rejectedPort) }));
  await waitForRejectedStartup(driftedApi, 'Model deployment configuration drift: mock-text');
  await setMockDeploymentTimeout(5_000);
  parseJsonOutput(run([distVerify], { capture: true }).stdout);

  const finalCounts = await inspectDatabase();
  assertCounts(finalCounts);
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    database: 'temporary_redacted_test_database',
    migrationCount,
    firstBootstrap: { changed: first.changed, manifestSha256: first.manifestSha256 },
    secondBootstrap: { changed: second.changed, manifestSha256: second.manifestSha256 },
    counts: finalCounts,
    mockSmoke: verification.mockSmoke,
    concurrentBootstrapVerified: true,
    apiStartupVerified: true,
    workerStartupVerified: true,
    driftedApiStartupRejected: true
  }, null, 2)}\n`);
} catch (error) {
  primaryFailure = error;
} finally {
  for (const child of [...children]) {
    try {
      await stopProcess(child);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (redisContainerStarted) {
    try {
      runExecutable('docker', ['rm', '--force', redisContainerName], {
        capture: true,
        cwd: backendRoot,
        label: 'temporary Redis cleanup'
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (databaseCreated) {
    try {
      executeAdmin(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE);`);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    cleanupFailures.push(error);
  }
}

if (primaryFailure && cleanupFailures.length) {
  throw new AggregateError([primaryFailure, ...cleanupFailures], 'System bootstrap acceptance and cleanup failed.');
}
if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'System bootstrap cleanup failed.');
