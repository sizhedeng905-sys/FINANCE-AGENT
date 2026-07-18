import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const distRoot = resolve(process.argv[2] ?? 'dist');
const runtime = JSON.parse(await readFile(resolve(distRoot, 'runtime-config.json'), 'utf8'));
const index = await readFile(resolve(distRoot, 'index.html'), 'utf8');

assert(runtime.dataMode === 'api', 'frontend bundle data mode must be api');
assert(runtime.apiBaseUrl === '/api', 'frontend bundle API base must be /api');
assert(Number.isInteger(runtime.apiTimeoutMs), 'frontend bundle timeout must be an integer');
assert(/<div\s+id=["']root["']/.test(index), 'frontend index is missing the React root');

for (const source of index.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)) {
  const asset = resolve(distRoot, `.${source[1]}`);
  assert((await stat(asset)).size > 0, `frontend asset is empty: ${source[1]}`);
}

process.stdout.write(`${JSON.stringify({ status: 'passed', runtime })}\n`);

function assert(condition, message) {
  if (!condition) throw new Error(`Staging frontend build verification failed: ${message}`);
}
