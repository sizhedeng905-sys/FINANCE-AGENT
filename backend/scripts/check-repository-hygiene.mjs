import { execFileSync } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
const files = output.split('\0').filter(Boolean);
const errors = [];
const blockedExtensions = new Set(['.safetensors', '.gguf', '.pt', '.pth', '.ckpt']);
const blockedSegments = ['model/', 'models/', 'backend/uploads/', 'backend/test-uploads/', 'test-results/', 'playwright-report/'];

for (const relativePath of files) {
  const normalized = relativePath.replaceAll('\\', '/');
  const name = basename(normalized);
  const extension = extname(name).toLowerCase();
  const isEnvironment = name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'));
  if (isEnvironment) errors.push(`${relativePath}: real environment file is tracked`);
  if (blockedExtensions.has(extension)) errors.push(`${relativePath}: model weight extension is tracked`);
  if (blockedSegments.some((segment) => normalized === segment.slice(0, -1) || normalized.includes(`/${segment}`) || normalized.startsWith(segment))) {
    errors.push(`${relativePath}: generated/model/upload path is tracked`);
  }

  const absolutePath = resolve(root, relativePath);
  const size = statSync(absolutePath).size;
  if (size > 20 * 1024 * 1024) errors.push(`${relativePath}: tracked file exceeds 20 MB`);
  if (size <= 1024 * 1024 && !blockedExtensions.has(extension)) {
    const content = readFileSync(absolutePath, 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
      errors.push(`${relativePath}: private key material is tracked`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Repository hygiene check failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Repository hygiene check passed for ${files.length} tracked or candidate files.`);
