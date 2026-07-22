import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

import { inspectSensitiveText } from './repository-hygiene-policy.mjs';

const root = resolve(import.meta.dirname, '../..');
const argumentsList = process.argv.slice(2);
const allowlist = JSON.parse(readFileSync(resolve(root, 'backend/config/repository-hygiene-allowlist.json'), 'utf8'));
const syntheticBusinessFiles = new Set(allowlist.syntheticBusinessFiles.map(normalize));
const syntheticDlpValues = new Set(allowlist.syntheticDlpValues);
const businessExtensions = new Set(['.xls', '.xlsx', '.csv', '.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.zip']);
const modelExtensions = new Set(['.safetensors', '.gguf', '.pt', '.pth', '.ckpt']);
const blockedSegments = [
  'model/',
  'models/',
  'backend/uploads/',
  'backend/test-uploads/',
  '.upload-quarantine/',
  'backend/.upload-quarantine/',
  'test-results/',
  'playwright-report/'
];

const internalTerms = loadInternalTerms();
const files = resolveFiles();
const errors = [];

for (const relativePath of files) {
  const normalized = normalize(relativePath);
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
  const name = basename(normalized);
  const extension = extname(name).toLowerCase();
  const isEnvironment = name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'));
  if (isEnvironment) errors.push(`${relativePath}: real environment file is a commit candidate`);
  if (modelExtensions.has(extension)) errors.push(`${relativePath}: model weight extension is blocked`);
  if (businessExtensions.has(extension) && !syntheticBusinessFiles.has(normalized)) {
    errors.push(`${relativePath}: business-data file extension is blocked by default`);
  }
  if (blockedSegments.some((segment) => normalized === segment.slice(0, -1) || normalized.includes(`/${segment}`) || normalized.startsWith(segment))) {
    errors.push(`${relativePath}: generated, model, upload, or quarantine path is blocked`);
  }

  const size = statSync(absolutePath).size;
  if (size > 20 * 1024 * 1024) errors.push(`${relativePath}: file exceeds the 20 MiB repository limit`);
  if (size <= 2 * 1024 * 1024 && !modelExtensions.has(extension)) {
    const buffer = readFileSync(absolutePath);
    if (!buffer.subarray(0, 8192).includes(0)) {
      const findings = inspectSensitiveText(buffer.toString('utf8'), { internalTerms, syntheticDlpValues });
      for (const finding of findings) errors.push(`${relativePath}: DLP ${finding}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Repository hygiene check failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Repository hygiene check passed for ${files.length} tracked or candidate files.`);

function resolveFiles() {
  const explicit = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] === '--path' && argumentsList[index + 1]) explicit.push(argumentsList[++index]);
  }
  if (explicit.length > 0) return [...new Set(explicit)];
  if (argumentsList.includes('--staged')) {
    return gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  }
  if (argumentsList.includes('--tracked')) return gitFiles(['ls-files', '-z']);
  return gitFiles(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
}

function gitFiles(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function loadInternalTerms() {
  const configured = process.env.DLP_INTERNAL_TERMS_FILE;
  if (!configured) return [];
  const path = resolve(root, configured);
  if (!existsSync(path)) throw new Error('DLP_INTERNAL_TERMS_FILE does not exist');
  return readFileSync(path, 'utf8').split(/\r?\n/).map((value) => value.trim()).filter((value) => value && !value.startsWith('#'));
}

function normalize(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}
