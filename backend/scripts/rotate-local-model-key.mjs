import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const secret = randomBytes(32).toString('hex');

await updateEnv(path.join(repositoryRoot, 'deploy', 'model-services', '.env'), ['LOCAL_MODEL_API_KEY']);
await updateEnv(path.join(repositoryRoot, 'backend', '.env'), [
  'LOCAL_MODEL_API_KEY',
  'AI_API_KEY',
  'VL_API_KEY',
  'OCR_API_KEY',
  'EMBEDDING_API_KEY'
]);
console.log('Rotated the local model key in ignored runtime environment files. Restart model and backend services.');

async function updateEnv(filePath, keys) {
  let source = await readFile(filePath, 'utf8');
  for (const key of keys) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    source = pattern.test(source)
      ? source.replace(pattern, `${key}=${secret}`)
      : `${source.replace(/\s*$/, '\n')}${key}=${secret}\n`;
  }
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, filePath);
}
