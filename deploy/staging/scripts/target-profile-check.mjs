import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTargetContext } from './target-context.mjs';
import { TargetProfileError } from './target-profile.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const environmentPath = resolve(stagingRoot, optionValue(arguments_, '--env-file') ?? '.env');
const evidenceRoot = join(stagingRoot, '.evidence');

try {
  const context = await loadTargetContext({ stagingRoot, environmentPath });
  const result = {
    ...context.targetProfile,
    checkedAt: new Date().toISOString(),
  };
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(evidenceRoot, 'target-profile-check.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const result = {
    schemaVersion: 'staging-target-profile/1.0',
    status: 'blocked_external',
    errorCode: error instanceof TargetProfileError ? error.code : 'TARGET_PROFILE_CHECK_FAILED',
    message: safeMessage(error),
    checkedAt: new Date().toISOString(),
  };
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 2;
}

function optionValue(arguments__, option) {
  const index = arguments__.indexOf(option);
  if (index === -1) return null;
  const value = arguments__[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function safeMessage(error) {
  if (error instanceof TargetProfileError) return error.message;
  if (error instanceof Error && /ENOENT/.test(error.message)) return 'A required target profile file is missing';
  return 'Target profile validation could not complete';
}
