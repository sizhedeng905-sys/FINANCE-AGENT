import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';

const backendRoot = resolve(import.meta.dirname, '..');
const prismaRoot = resolve(backendRoot, 'prisma');
const envFile = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');

if (existsSync(envFile)) loadEnvFile(envFile);

const sourceDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for migration-path verification.');
}

const sourceUrl = new URL(sourceDatabaseUrl);
const sourceDatabase = decodeURIComponent(sourceUrl.pathname.replace(/^\//, ''));
if (!sourceDatabase.endsWith('_test')) {
  throw new Error(`Migration-path verification refuses to use non-test database "${sourceDatabase}".`);
}

const suffix = `${process.pid}_${Date.now().toString(36)}`;
const emptyDatabase = `fa_rc_empty_${suffix}_test`;
const upgradeDatabase = `fa_rc_upgrade_${suffix}_test`;
const temporaryRoot = await mkdtemp(join(tmpdir(), 'finance-agent-migrations-'));
const baselinePrismaRoot = resolve(temporaryRoot, 'prisma');
const prismaCli = resolve(backendRoot, 'node_modules/prisma/build/index.js');
const tsxCli = resolve(backendRoot, 'node_modules/tsx/dist/cli.mjs');
const createdDatabases = [];

function databaseUrl(name) {
  const value = new URL(sourceUrl);
  value.pathname = `/${name}`;
  return value.toString();
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd || backendRoot,
    env: {
      ...process.env,
      DATABASE_URL: options.databaseUrl || sourceDatabaseUrl
    },
    input: options.input,
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const command = args[0] === prismaCli ? `prisma ${args[1] || ''}`.trim() : 'database structure verification';
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
}

function executeAdmin(sql) {
  runNode(
    [prismaCli, 'db', 'execute', '--stdin', '--schema', resolve(prismaRoot, 'schema.prisma')],
    { input: sql, databaseUrl: databaseUrl('postgres') }
  );
}

function createDatabase(name) {
  executeAdmin(`CREATE DATABASE "${name}";`);
  createdDatabases.push(name);
}

function migrateAndVerify(url, schemaPath) {
  runNode([prismaCli, 'migrate', 'deploy', '--schema', schemaPath], { databaseUrl: url });
  runNode([prismaCli, 'migrate', 'status', '--schema', resolve(prismaRoot, 'schema.prisma')], { databaseUrl: url });
  runNode([tsxCli, 'scripts/verify-database.ts'], { databaseUrl: url });
}

async function prepareBaselineMigrations() {
  const entries = (await readdir(resolve(prismaRoot, 'migrations'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (entries.length < 2) throw new Error('At least two migrations are required for baseline upgrade verification.');

  await mkdir(resolve(baselinePrismaRoot, 'migrations'), { recursive: true });
  await cp(resolve(prismaRoot, 'schema.prisma'), resolve(baselinePrismaRoot, 'schema.prisma'));
  await cp(
    resolve(prismaRoot, 'migrations', 'migration_lock.toml'),
    resolve(baselinePrismaRoot, 'migrations', 'migration_lock.toml')
  );
  for (const entry of entries.slice(0, -1)) {
    await cp(
      resolve(prismaRoot, 'migrations', entry),
      resolve(baselinePrismaRoot, 'migrations', entry),
      { recursive: true }
    );
  }
  return { migrationCount: entries.length, baselineCount: entries.length - 1, latestMigration: entries.at(-1) };
}

let primaryFailure;
const cleanupFailures = [];
try {
  const migrationSet = await prepareBaselineMigrations();

  createDatabase(emptyDatabase);
  migrateAndVerify(databaseUrl(emptyDatabase), resolve(prismaRoot, 'schema.prisma'));

  createDatabase(upgradeDatabase);
  runNode(
    [prismaCli, 'migrate', 'deploy', '--schema', resolve(baselinePrismaRoot, 'schema.prisma')],
    { databaseUrl: databaseUrl(upgradeDatabase) }
  );
  migrateAndVerify(databaseUrl(upgradeDatabase), resolve(prismaRoot, 'schema.prisma'));

  console.log(JSON.stringify({
    status: 'passed',
    emptyDatabaseMigrations: migrationSet.migrationCount,
    baselineMigrations: migrationSet.baselineCount,
    upgradedMigration: migrationSet.latestMigration
  }, null, 2));
} catch (error) {
  primaryFailure = error;
} finally {
  for (const name of createdDatabases.reverse()) {
    try {
      executeAdmin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (primaryFailure) throw primaryFailure;
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Failed to clean temporary migration databases.');
