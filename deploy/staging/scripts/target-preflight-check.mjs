import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTargetContext } from './target-context.mjs';
import {
  blockedTargetPreflight,
  renderTargetPreflightMarkdown,
  runTargetPreflight,
} from './target-preflight.mjs';
import { createSystemPreflightAdapter } from './target-preflight-system.mjs';
import { TargetProfileError } from './target-profile.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const environmentPath = optionValue(arguments_, '--env-file') ?? '.env';
const evidenceRoot = join(stagingRoot, '.evidence');
let result;

try {
  const context = await loadTargetContext({ stagingRoot, environmentPath });
  result = await runTargetPreflight({
    settings: context.settings,
    environment: context.environment,
    targetProfile: context.targetProfile,
    adapter: createSystemPreflightAdapter({ stagingRoot, tlsRoot: context.tlsRoot }),
  });
} catch (error) {
  result = blockedTargetPreflight(
    error instanceof TargetProfileError ? error.code : 'TARGET_CONTEXT_UNAVAILABLE',
  );
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const evidenceId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const jsonPath = join(evidenceRoot, `target-preflight-${evidenceId}.json`);
const markdownPath = join(evidenceRoot, `target-preflight-${evidenceId}.md`);
await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
await writeFile(markdownPath, renderTargetPreflightMarkdown(result), { mode: 0o600 });

const summary = {
  schemaVersion: result.schemaVersion,
  status: result.status,
  summary: result.summary,
  jsonPath: relative(stagingRoot, jsonPath).replace(/\\/g, '/'),
  markdownPath: relative(stagingRoot, markdownPath).replace(/\\/g, '/'),
};
const output = `${JSON.stringify(summary, null, 2)}\n`;
if (result.status === 'passed') process.stdout.write(output);
else process.stderr.write(output);
process.exitCode = result.status === 'passed' ? 0 : result.status === 'blocked_external' ? 2 : 1;

function optionValue(arguments__, option) {
  const index = arguments__.indexOf(option);
  if (index === -1) return null;
  const value = arguments__[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}
