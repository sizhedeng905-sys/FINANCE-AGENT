import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

export const DEMO_DATABASE_NAME = 'finance_agent_test';
export const DEMO_API_URL = 'http://127.0.0.1:3101';
export const DEMO_WEB_URL = 'http://127.0.0.1:4173';

const backendRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(backendRoot, '..');
const demoEnvFile = resolve(backendRoot, '.env.test');
const demoFixturePath = resolve(backendRoot, 'test-uploads/e2e-fixtures/E2E 周五演示费用导入.xlsx');
const allowedLoopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function inspectDemoDatabase(databaseUrl, nodeEnv = '') {
  if (nodeEnv === 'production') {
    throw new Error('Demo commands refuse to run with NODE_ENV=production.');
  }
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for demo commands.');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Demo commands only support PostgreSQL TEST_DATABASE_URL values.');
  }
  if (!allowedLoopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('Demo commands only allow a loopback PostgreSQL host.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (databaseName !== DEMO_DATABASE_NAME) {
    throw new Error(`Demo commands only allow database "${DEMO_DATABASE_NAME}".`);
  }

  return {
    databaseName,
    host: 'loopback',
    port: parsed.port || '5432'
  };
}

export function buildDemoEnvironment(source) {
  const databaseUrl = source.TEST_DATABASE_URL;
  const database = inspectDemoDatabase(databaseUrl, source.NODE_ENV);
  const jwtSecret = String(source.JWT_SECRET ?? '');
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters in backend/.env.test.');
  }

  return {
    database,
    environment: {
      ...source,
      NODE_ENV: 'test',
      PROCESS_ROLE: 'all',
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      JWT_SECRET: jwtSecret,
      PORT: '3101',
      CORS_ORIGINS: DEMO_WEB_URL,
      REQUEST_RATE_LIMIT_STORE: 'memory',
      LOGIN_RATE_LIMIT_STORE: 'memory',
      UPLOAD_ADMISSION_STORE: 'memory',
      MODEL_EXECUTION_GATE_STORE: 'memory',
      REDIS_URL: '',
      FILE_STORAGE_DRIVER: 'local',
      FILE_SCAN_MODE: 'basic',
      UPLOAD_DIR: 'test-uploads/demo',
      SEED_ALLOW_NONSTANDARD_DATABASE: 'false',
      SEED_DEMO_CONFIRMATION: `reset-demo-users:${database.databaseName}`,
      AI_PROVIDER: 'mock',
      AI_PROVIDER_CLASS: 'mock',
      AI_INGESTION_MODE: 'suggest',
      AI_REPORT_MODE: 'suggest',
      AI_GLOBAL_KILL_SWITCH: 'false',
      AI_EXTERNAL_PROVIDER_MODE: 'disabled',
      AI_MODEL: 'mock-structured-v1',
      AI_BASE_URL: 'http://127.0.0.1:11434/v1',
      AI_API_KEY: '',
      OPENAI_API_KEY: '',
      OCR_PROVIDER: 'mock',
      OCR_MODEL: 'mock-ocr-v1',
      OCR_BASE_URL: 'http://127.0.0.1:8868',
      OCR_API_KEY: '',
      AI_SYSTEM_REGISTRY_STARTUP_MODE: 'disabled',
      S3_ENDPOINT: '',
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: ''
    }
  };
}

export function mergeDemoEnvironmentSources(runtimeEnvironment, fileEnvironment) {
  if (runtimeEnvironment.NODE_ENV === 'production') {
    throw new Error('Demo commands refuse to run with NODE_ENV=production.');
  }
  return { ...runtimeEnvironment, ...fileEnvironment };
}

export function buildDemoWebEnvironment(source) {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    const credentialLike = /(^|_)(PASSWORD|TOKEN|SECRET|API_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY)($|_)/.test(key);
    const backendOnly = key.startsWith('VITE_')
      || key.startsWith('AI_')
      || key.startsWith('OCR_')
      || key.startsWith('S3_')
      || key.startsWith('JWT_')
      || key.startsWith('SEED_')
      || ['DATABASE_URL', 'TEST_DATABASE_URL', 'REDIS_URL'].includes(key);
    if (credentialLike || backendOnly) delete environment[key];
  }
  return {
    ...environment,
    VITE_APP_DATA_MODE: 'api',
    VITE_API_BASE_URL: `${DEMO_API_URL}/api`,
    VITE_API_TIMEOUT_MS: '15000'
  };
}

export function amountToCents(value) {
  const formulaResult = value && typeof value === 'object' && 'result' in value ? value.result : value;
  const lexical = String(formulaResult ?? '');
  if (!/^\d+\.\d{2}$/.test(lexical)) {
    throw new Error(`Demo fixture amount must have exactly two decimals: ${lexical}`);
  }
  const [units, fraction] = lexical.split('.');
  return BigInt(units) * 100n + BigInt(fraction);
}

function loadDemoEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo commands refuse to run with NODE_ENV=production.');
  }
  if (!existsSync(demoEnvFile)) {
    throw new Error('backend/.env.test is required. Create it from backend/.env.test.example.');
  }
  const fileEnvironment = parseEnv(readFileSync(demoEnvFile, 'utf8'));
  return buildDemoEnvironment(mergeDemoEnvironmentSources(process.env, fileEnvironment));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.signal !== 'SIGINT') {
    throw new Error(`${options.label ?? command} exited with status ${result.status ?? 'unknown'}.`);
  }
}

async function inspectFixture() {
  if (!existsSync(demoFixturePath)) {
    throw new Error('Friday demo fixture is missing. Run npm run demo:reset first.');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(demoFixturePath);
  const sheet = workbook.getWorksheet('周五演示费用明细');
  if (!sheet) throw new Error('Friday demo fixture sheet is missing.');
  if (sheet.actualRowCount !== 4) throw new Error('Friday demo fixture must contain one header and exactly three rows.');

  const expectedHeaders = ['发生日期', '费用金额', '车牌', '司机'];
  const headers = expectedHeaders.map((_, index) => String(sheet.getRow(1).getCell(index + 1).value ?? ''));
  if (headers.some((value, index) => value !== expectedHeaders[index])) {
    throw new Error('Friday demo fixture headers do not match the acceptance contract.');
  }

  const cents = [2, 3, 4].map((row) => amountToCents(sheet.getRow(row).getCell(2).value));
  const expectedCents = [125025n, 876543n, 340653n];
  if (cents.some((value, index) => value !== expectedCents[index])) {
    throw new Error('Friday demo fixture amounts do not match the acceptance contract.');
  }
  const formulaValue = sheet.getRow(3).getCell(2).value;
  if (!formulaValue || typeof formulaValue !== 'object' || formulaValue.formula !== 'SUM(8000,765.43)') {
    throw new Error('Friday demo fixture formula evidence is missing.');
  }

  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const expectedDate = `${dateValues.year}/${dateValues.month}/${dateValues.day}`;
  const dates = [2, 3, 4].map((row) => String(sheet.getRow(row).getCell(1).value ?? ''));
  if (dates.some((value) => value !== expectedDate)) {
    throw new Error('Friday demo fixture dates must match the current Asia/Shanghai report date.');
  }
  const file = await readFile(demoFixturePath);
  const fileStats = await stat(demoFixturePath);

  return {
    fileName: 'E2E 周五演示费用导入.xlsx',
    sheet: sheet.name,
    rows: cents.length,
    amounts: cents.map((value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`),
    total: '13422.21',
    reportDate: expectedDate,
    sha256: createHash('sha256').update(file).digest('hex'),
    sizeBytes: fileStats.size
  };
}

async function verifyDemoState(configuration = loadDemoEnvironment()) {
  const prisma = new PrismaClient({ datasourceUrl: configuration.environment.DATABASE_URL });
  try {
    const [users, project, template, projectTemplate, fixture] = await Promise.all([
      prisma.user.findMany({
        where: { username: { in: ['finance', '财务', 'boss'] } },
        select: { username: true, role: true, status: true }
      }),
      prisma.project.findUnique({ where: { id: 'dp-001' }, select: { id: true, name: true, status: true } }),
      prisma.template.findUnique({ where: { id: 'dt-transport' }, select: { id: true, name: true, version: true } }),
      prisma.projectTemplate.findUnique({
        where: { projectId_templateId: { projectId: 'dp-001', templateId: 'dt-transport' } },
        select: { isActive: true }
      }),
      inspectFixture()
    ]);

    const expectedUsers = new Map([
      ['finance', 'finance'],
      ['财务', 'finance'],
      ['boss', 'boss']
    ]);
    if (users.length !== expectedUsers.size || users.some((user) => expectedUsers.get(user.username) !== user.role || user.status !== 'active')) {
      throw new Error('Demo accounts are missing, inactive, or have unexpected roles. Run npm run demo:reset.');
    }
    if (project?.name !== '太和中转项目' || project.status !== 'active') {
      throw new Error('Demo project is missing or inactive. Run npm run demo:reset.');
    }
    if (template?.name !== '运输费用模板' || !projectTemplate?.isActive) {
      throw new Error('Demo transport template is missing or not enabled for the demo project.');
    }

    return {
      status: 'ok',
      database: configuration.database,
      accounts: users.sort((left, right) => left.username.localeCompare(right.username, 'zh-CN')),
      project,
      template,
      fixture,
      providers: { ai: 'mock', ocr: 'mock', external: 'disabled' }
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const command = process.argv[2];
  const configuration = loadDemoEnvironment();

  if (command === 'reset') {
    run(process.execPath, [resolve(backendRoot, 'scripts/prepare-e2e.mjs')], {
      cwd: backendRoot,
      env: configuration.environment,
      label: 'existing E2E prepare chain'
    });
    const result = await verifyDemoState(configuration);
    console.log(`DEMO_RESET_OK ${JSON.stringify(result)}`);
    return;
  }
  if (command === 'verify') {
    const result = await verifyDemoState(configuration);
    console.log(`DEMO_VERIFY_OK ${JSON.stringify(result)}`);
    return;
  }
  if (command === 'api') {
    await verifyDemoState(configuration);
    console.log(`Starting local demo API at ${DEMO_API_URL}; database=${configuration.database.databaseName}; providers=mock.`);
    run(
      process.execPath,
      ['--require', 'ts-node/register/transpile-only', 'src/main.ts'],
      { cwd: backendRoot, env: configuration.environment, label: 'demo API' }
    );
    return;
  }
  if (command === 'web') {
    console.log(`Starting local demo web app at ${DEMO_WEB_URL}; API=${DEMO_API_URL}/api.`);
    run(
      process.execPath,
      [resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
      { cwd: repositoryRoot, env: buildDemoWebEnvironment(configuration.environment), label: 'demo web app' }
    );
    return;
  }

  throw new Error('Usage: node backend/scripts/demo-environment.mjs <reset|verify|api|web>');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
