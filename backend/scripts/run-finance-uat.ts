import { PrismaClient } from '@prisma/client';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  assertFinanceUatTestDatabase,
  buildFinanceUatReport,
  collectFinanceUatSnapshot,
  createBlankFinanceUatManifest,
  databaseFingerprint,
  validateFinanceUatManifest
} from './finance-uat-lib';

const repositoryRoot = resolve(__dirname, '..', '..');
const uatRoot = resolve(repositoryRoot, '.realdata-test', 'uat');
const defaultWorkspace = resolve(uatRoot, 'b8-08');
const command = process.argv[2];

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`B8-08 UAT tool failed: ${message}`);
  process.exitCode = 1;
});

async function main() {
  switch (command) {
    case 'init':
      await initializeWorkspace(resolveSafeUatPath(process.argv[3] || defaultWorkspace));
      return;
    case 'validate':
      await validateManifestFile(resolveManifestPath(process.argv[3]));
      return;
    case 'reconcile':
      await reconcile(resolveManifestPath(process.argv[3]), process.argv[4]);
      return;
    default:
      throw new Error('Usage: run-finance-uat.ts init [workspace] | validate [manifest] | reconcile [manifest] [output]');
  }
}

async function initializeWorkspace(workspace: string) {
  await mkdir(workspace, { recursive: true });
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const files = [
    writeIfMissing(
      resolve(workspace, 'manifest.local.json'),
      `${JSON.stringify(createBlankFinanceUatManifest(`B8-08-UAT-${date}`), null, 2)}\n`
    ),
    copyIfMissing(
      resolve(repositoryRoot, 'docs', 'templates', 'B8_08_UAT_ISSUE_LOG_TEMPLATE.md'),
      resolve(workspace, 'issue-log.local.md')
    ),
    copyIfMissing(
      resolve(repositoryRoot, 'docs', 'templates', 'B8_08_UAT_SIGNOFF_TEMPLATE.md'),
      resolve(workspace, 'signoff.local.md')
    )
  ];
  const results = await Promise.all(files);
  console.log(`B8-08 UAT workspace ready: ${relative(repositoryRoot, workspace)} (${results.filter(Boolean).length} new file(s)).`);
}

async function validateManifestFile(manifestPath: string) {
  const manifest = validateFinanceUatManifest(await readJson(manifestPath));
  console.log(`B8-08 UAT manifest is valid: run=${manifest.runId}, cases=${manifest.cases.length}, humanSignoffs=${manifest.signoffs.length}.`);
}

async function reconcile(manifestPath: string, requestedOutput?: string) {
  const manifest = validateFinanceUatManifest(await readJson(manifestPath));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for reconciliation.');
  const databaseName = assertFinanceUatTestDatabase(databaseUrl);
  const outputPath = requestedOutput
    ? resolveSafeUatPath(requestedOutput)
    : resolveSafeUatPath(resolve(dirname(manifestPath), 'reconciliation-report.local.json'));
  await mkdir(dirname(outputPath), { recursive: true });

  const prisma = new PrismaClient();
  try {
    const snapshot = await collectFinanceUatSnapshot(prisma, manifest);
    const report = {
      ...buildFinanceUatReport(manifest, snapshot),
      databaseFingerprint: databaseFingerprint(databaseName)
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(
      `B8-08 reconciliation complete: automatic=${report.automaticStatus}, human=${report.humanGateStatus}, output=${relative(repositoryRoot, outputPath)}.`
    );
    if (report.automaticStatus === 'failed' || report.untrackedFailures.length > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

function resolveManifestPath(requested?: string): string {
  return resolveSafeUatPath(requested || resolve(defaultWorkspace, 'manifest.local.json'));
}

function resolveSafeUatPath(requested: string): string {
  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(repositoryRoot, requested);
  const child = relative(uatRoot, absolute);
  if (!child || child.startsWith('..') || child.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`UAT paths must stay below ${relative(repositoryRoot, uatRoot)}.`);
  }
  return absolute;
}

async function readJson(filePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new Error(`Cannot read UAT manifest ${relative(repositoryRoot, filePath)}. Run uat:init first.`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`UAT manifest is not valid JSON: ${relative(repositoryRoot, filePath)}.`);
  }
}

async function writeIfMissing(filePath: string, contents: string): Promise<boolean> {
  try {
    await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

async function copyIfMissing(source: string, destination: string): Promise<boolean> {
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}
